'use strict';

const { tuple } = require('@devsnek/earl');
const { Node, send } = require('./node');
const { spawn, self } = require('./process');
const { GenServer } = require('./gen_server');

module.exports = {
  Node,
  GenServer,
  spawn,
  send,
  self,

  tuple,
};
