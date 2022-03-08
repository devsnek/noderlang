'use strict';

const { tuple } = require('@devsnek/earl');
const { AsyncLocalStorage } = require('async_hooks');
const N = require('./node');

const currentProcess = new AsyncLocalStorage();

function refToId(ref) {
  return `Ref<${ref.node}.${ref.creation}.${ref.id}>`;
}

class LinkedQueue {
  constructor() {
    this.size = 0;
    this.item = null;
    this.last = null;
  }

  push(value) {
    const next = { value, next: null };
    if (this.item) {
      this.last.next = next;
      this.last = next;
    } else {
      this.item = next;
      this.last = next;
    }
    this.size += 1;
  }

  shift() {
    if (!this.item) {
      return undefined;
    }
    this.size -= 1;
    const { value } = this.item;
    this.item = this.item.next;
    return value;
  }
}

class Process {
  constructor(node, f, name) {
    this.node = node;
    this.name = name;
    this.inbox = new LinkedQueue();
    this.onInboxItem = null;
    this.monitoredBy = new Map();

    this.pid = this.node.register(this);

    this.run(f)
      .then(
        () => {
          this.cleanup();
        },
        (e) => {
          this.cleanup();
          throw e;
        },
      );
  }

  cleanup(reason) {
    this.monitoredBy.forEach((pid, ref) => {
      const message = tuple(Symbol('DOWN'), ref, Symbol('process'), this.pid, reason);
      this.node.send(this.pid, pid, message);
    });
    this.node.unregister(this);
  }

  async run(f) {
    const gen = currentProcess.run(this, () => this.node.scope(f));

    let message;
    while (true) {
      const { done } = await currentProcess.run(
        this,
        () => this.node.scope(() => gen.next(message)),
      );
      if (done) {
        break;
      }
      message = await this.receive();
    }
  }

  post(message) {
    this.inbox.push(message);
    this.onInboxItem?.();
  }

  async receive(timeout) {
    if (this.onInboxItem) {
      throw new Error(`multiple receives ${this.pid[Symbol.for('nodejs.util.inspect.custom')]()}`);
    }
    if (this.inbox.size <= 0) {
      await new Promise((resolve, reject) => {
        this.onInboxItem = () => {
          this.onInboxItem = null;
          resolve();
        };
        if (timeout) {
          setTimeout(() => reject(new Error('receive timed out')), timeout);
        }
      });
    }
    return this.inbox.shift();
  }

  addMonitoredBy(ref, pid) {
    this.monitoredBy.set(refToId(ref), pid);
  }

  removeMonitoredBy(ref, _pid) {
    this.monitoredBy.delete(refToId(ref));
  }

  static get() {
    return currentProcess.getStore();
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    if (this.name) {
      return `Process<${this.name} ${this.pid}>`;
    }
    return `Process<${this.pid}>`;
  }
}

function spawn(f, name) {
  const node = N.Node.get();
  const process = new Process(node, f, name);
  return process.pid;
}

function self() {
  return Process.get().pid;
}

module.exports = { Process, spawn, self };
