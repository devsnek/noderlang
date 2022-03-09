'use strict';

const crypto = require('crypto');
const os = require('os');
const util = require('util');
const earl = require('@devsnek/earl');
const { tuple, Reference, Pid } = require('@devsnek/earl');
const { AsyncLocalStorage } = require('async_hooks');
const { Distribution } = require('./distribution');
const { ControlMessages } = require('./constants');

const currentNode = new AsyncLocalStorage();
const debuglog = util.debuglog('dist-node');

function pidToId(pid) {
  return `${pid.creation}.${pid.id}.${pid.serial} @ ${pid.node}`;
}

class Node {
  static start(name, f) {
    const { spawn } = require('./process');
    const { NetKernel } = require('./net_kernel');

    const node = new Node(name);

    node.dist.once('connected', () => {
      node.scope(() => {
        NetKernel.startLink([], 'net_kernel');
        spawn(f);
      });
    });

    return node;
  }

  static get() {
    return currentNode.getStore();
  }

  constructor(name) {
    this.name = `${name}@${os.hostname()}`;
    this.dist = new Distribution(this);
    this.pidCounter = 0;
    this.byId = new Map();
    this.byName = new Map();
    this.byRef = new Map();
  }

  getByPid(pid) {
    return this.byId.get(pidToId(pid));
  }

  handleControlMessage(control, message) {
    switch (control[0]) {
      case ControlMessages.SEND: {
        const unpacked = earl.unpack(message, {
          mapToObject: false,
          atomToString: false,
        });
        this.send(null, control[2], unpacked);
        break;
      }
      case ControlMessages.REG_SEND: {
        const unpacked = earl.unpack(message, {
          mapToObject: false,
          atomToString: false,
        });
        this.send(control[1], control[3], unpacked);
        break;
      }
      case ControlMessages.SEND_SENDER: {
        const unpacked = earl.unpack(message, {
          mapToObject: false,
          atomToString: false,
        });
        this.send(control[1], control[2], unpacked);
        break;
      }
      case ControlMessages.ALIAS_SEND: {
        const unpacked = earl.unpack(message, {
          mapToObject: false,
          atomToString: false,
        });
        this.send(control[1], control[2], unpacked);
        break;
      }
      case ControlMessages.MONITOR_P:
        this.monitor(control[1], control[2], control[3]);
        break;
      case ControlMessages.DEMONITOR_P:
        this.demonitor(control[1], control[2], control[3]);
        break;
      case ControlMessages.MONITOR_P_EXIT:
        this.send(
          control[1],
          control[2],
          tuple('DOWN', control[3], Symbol('process'), control[1], control[4]),
        );
        break;
      default:
        debuglog('Unknown control message', control);
    }
  }

  register(process) {
    const id = this.pidCounter;
    this.pidCounter += 1;

    const pid = new Pid(
      this.name,
      Math.floor(id / 0x7fffffff),
      id % 0x7fffffff,
      this.dist.creation,
    );

    this.byId.set(pidToId(pid), process);
    if (process.name) {
      this.byName.set(process.name, process);
    }

    return pid;
  }

  unregister(process) {
    this.byId.delete(pidToId(process.pid));
    this.byName.delete(process.name);
  }

  alias(pid) {
    const ref = new Reference(this.name, this.dist.creation, crypto.randomBytes(3));
    this.byRef.set(ref.id, this.getByPid(pid));
  }

  monitor(origin, target, existingRef) {
    const ref = existingRef ?? new Reference(this.name, this.dist.creation, crypto.randomBytes(3));

    if (typeof target === 'symbol') {
      this.byName.get(target.description)?.addMonitoredBy(origin, ref);
    } else if (target instanceof Pid) {
      if (target.node === this.name) {
        this.getByPid(target)?.addMonitoredBy(origin, ref);
      } else {
        this.dist.getNode(target.node)
          .then((node) => node.control([ControlMessages.MONITOR_P, origin, target, ref]));
      }
    } else if (Array.isArray(target)) {
      if (target[1] === this.name) {
        this.byName.get(target[0].description).addMonitoredBy(origin, ref);
      } else {
        this.dist.getNode(target[1])
          .then((node) => node.control([ControlMessages.MONITOR_P, origin, target[0], ref]));
      }
    }

    return ref;
  }

  demonitor(origin, target, ref) {
    this.byRef.delete(ref.id);

    if (typeof target === 'symbol') {
      this.byName.get(target.description)?.removeMonitoredBy(origin, ref);
    } else if (target instanceof Pid) {
      if (target.node === this.name) {
        this.getByPid(target)?.removeMonitoredBy(origin, ref);
      } else {
        this.dist.getNode(target.node)
          .then((node) => node.control([ControlMessages.DEMONITOR_P, origin, target, ref]));
      }
    } else if (Array.isArray(target)) {
      if (target[1] === this.name) {
        this.byName.get(target[0].description).removeMonitoredBy(origin, ref);
      } else {
        this.dist.getNode(target[1])
          .then((node) => node.control([ControlMessages.DEMONITOR_P, origin, target[0], ref]));
      }
    }
  }

  send(sender, receiver, message) {
    if (receiver instanceof Pid) {
      if (receiver.node === this.name) {
        this.getByPid(receiver)?.post(message);
        return;
      }
      this.dist
        .getNode(receiver.node)
        .then((node) => {
          node.control([
            ControlMessages.SEND_SENDER,
            sender,
            receiver,
          ], message);
        });
      return;
    }
    if (receiver instanceof Reference) {
      if (receiver.node === this.name) {
        this.byRef.get(receiver.id)?.post(message);
        return;
      }
      this.getNode(receiver.node)
        .then((node) => {
          node.control([
            ControlMessages.ALIAS_SEND,
            sender,
            receiver,
          ], message);
        });
      return;
    }
    if (typeof receiver === 'symbol') {
      this.byName.get(receiver.description)?.post(message);
      return;
    }
    if (Array.isArray(receiver)) {
      if (receiver[1] === this.name) {
        this.byName.get(receiver[0])?.post(message);
        return;
      }
      this.dist
        .getNode(receiver[1])
        .then((node) => {
          node.control([
            ControlMessages.REG_SEND,
            sender,
            Symbol(''),
            receiver[0],
          ], message);
        });
      return;
    }

    debuglog('Did not understand receiver', receiver);
  }

  scope(f) {
    return currentNode.run(this, f);
  }
}

function send(...args) {
  const { self } = require('./process');

  return Node.get().send(self(), ...args);
}

module.exports.Node = Node;
module.exports.send = send;
