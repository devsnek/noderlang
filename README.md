# Noderlang - Erlang node in Node.js

Noderlang allows Node.js programs to easily operate in BEAM environments,
appearing as a normal BEAM node to other nodes.

```js
const { Node, send, self, tuple: t } = require('noderlang');

// Start a distribution node. It will be available as `js@hostname`.
Node.start('js', async function* root() {
  // Atoms are represented in JavaScript as Symbols.
  send([Symbol('some_process'), 'foo@bar'], t(self(), Symbol('hello!')));

  Something.startLink([]);

  while (true) {
    // `yield` is like `receive` in Erlang.
    const message = yield;

    console.log(messagea);
  }
});

// You can also use GenServer.
class Something extends GenServer {
  async handleCall(value) {
    // Return value is used as response.
    return otherValue - 2;
  }

  async handleCast(value) {
    // Making calls is simple.
    const otherValue = await GenServer.call(somePid, value + 2);
  }

  async handleInfo(value) {
    console.log('got info', value);
  }
}
```

## Current Status

This is currently WIP. Basic functionality like message passing and GenServer
work, but overall stability needs to be improved.

This is greatly inspired by [Pyrlang][].

[Pyrlang]: https://github.com/Pyrlang/Pyrlang
