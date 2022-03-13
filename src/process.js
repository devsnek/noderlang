'use strict';

const { tuple } = require('@devsnek/earl');
const { AsyncLocalStorage } = require('async_hooks');
const N = require('./node');

const currentProcess = new AsyncLocalStorage();

function refToId(ref) {
  return `Ref<${ref.node}.${ref.creation}.${ref.id}>`;
}

const kNoValue = Symbol('kNoValue');

class LinkedQueue {
  constructor() {
    this.size = 0;
    this.next = null;
    this.last = null;
    this.subscriptions = new Set();
  }

  push(value) {
    for (const matcher of this.subscriptions) {
      if (matcher(value)) {
        this.subscriptions.delete(matcher);
        return;
      }
    }
    const next = { value, next: null };
    if (this.next) {
      this.last.next = next;
      this.last = next;
    } else {
      this.next = next;
      this.last = next;
    }
    this.size += 1;
  }

  take(matcher) {
    let last = this;
    let cursor = this.next;
    while (cursor) {
      if (matcher(cursor.value)) {
        last.next = cursor.next;
        if (!cursor.next) {
          this.last = last;
        }
        return cursor.value;
      }
      last = cursor;
      cursor = cursor.next;
    }
    return kNoValue;
  }
}

class Process {
  constructor(node, f, name) {
    this.node = node;
    this.name = name;
    this.inbox = new LinkedQueue();
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
      const { done, value: matcher } = await currentProcess.run(
        this,
        () => this.node.scope(() => gen.next(message)),
      );
      if (done) {
        break;
      }
      message = await this.receive(matcher);
    }
  }

  post(message) {
    this.inbox.push(message);
    this.onInboxItem?.();
  }

  receive(matcher = () => true, timeout = Infinity) {
    const message = this.inbox.take(matcher);
    if (message !== kNoValue) {
      return Promise.resolve(message);
    }

    return new Promise((resolve, reject) => {
      let timer;

      const f = (v) => {
        if (matcher(v)) {
          clearTimeout(timer);
          resolve(v);
          return true;
        }
        return false;
      };

      if (timeout !== Infinity) {
        timer = setTimeout(() => {
          this.inbox.subscriptions.delete(f);
          reject(new Error('receive timed out'));
        }, timeout);
      }

      this.inbox.subscriptions.add(f);
    });
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
