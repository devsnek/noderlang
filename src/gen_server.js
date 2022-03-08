'use strict';

const { tuple } = require('@devsnek/earl');
const { self, spawn } = require('./process');
const { Node, send } = require('./node');

class GenServer {
  constructor() {
    this.pid = null;
  }

  static startLink(args, name) {
    const C = this;

    async function* genServer() {
      const inst = new C();
      inst.pid = self();

      inst.init(...args);

      while (true) {
        const message = yield;
        await inst.onMessage(message);
      }
    }

    return spawn(genServer, name);
  }

  static async call(targetPid, data, timeout = 5000) {
    const node = Node.get();

    const result = await new Promise((resolve, reject) => {
      if (timeout !== Infinity) {
        setTimeout(() => reject(new Error('call timed out')), timeout);
      }

      spawn(async function* innerGen() {
        const pid = self();

        let mRef;
        try {
          mRef = node.monitor(pid, targetPid, mRef);

          const message = tuple(Symbol('$gen_call'), tuple(Symbol('alias'), mRef), data);
          send(targetPid, message);

          const response = yield;
          resolve(response);
        } catch (e) {
          reject(e);
        } finally {
          if (mRef) {
            node.demonitor(pid, targetPid, mRef);
          }
        }
      });
    });

    if (result?.[0]?.head?.[0] === Symbol('alias')) {
      return result[1];
    }

    return result;
  }

  static async cast(pid, data) {
    const message = tuple(Symbol('$gen_cast'), data);
    send(pid, message);
  }

  async onMessage(message) {
    if (Array.isArray(message) && message[0]?.description === '$gen_call') {
      const response = await this.handleCall(message[2]);
      Node.get().send(this.pid, message[1][0], tuple(message[1][1], response));
    } else if (Array.isArray(message) && message[0]?.description === '$gen_cast') {
      await this.handleCast(message[1]);
    } else {
      await this.handleInfo(message);
    }
  }

  init() {}

  handleCall() {}

  handleCast() {}

  handleInfo() {}
}

module.exports = { GenServer };
