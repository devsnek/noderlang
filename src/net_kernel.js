'use strict';

const { GenServer } = require('./gen_server');

class NetKernel extends GenServer {
  handleCall(message) {
    if (Array.isArray(message) && message[0] === 'is_auth') {
      return Symbol('yes');
    }

    return undefined;
  }
}

module.exports = { NetKernel };
