'use strict';

exports.DFLAG_PUBLISHED = 1n << 0n;
exports.DFLAG_ATOM_CACHE = 1n << 1n;
exports.DFLAG_EXTENDED_REFERENCES = 1n << 2n;
exports.DFLAG_DIST_MONITOR = 1n << 3n;
exports.DFLAG_FUN_TAGS = 1n << 4n;
exports.DFLAG_DIST_MONITOR_NAME = 1n << 5n;
exports.DFLAG_HIDDEN_ATOM_CACHE = 1n << 6n;
exports.DFLAG_NEW_FUN_TAGS = 1n << 7n;
exports.DFLAG_EXTENDED_PIDS_PORTS = 1n << 8n;
exports.DFLAG_EXPORT_PTR_TAG = 1n << 9n;
exports.DFLAG_BIT_BINARIES = 1n << 10n;
exports.DFLAG_NEW_FLOATS = 1n << 11n;
exports.DFLAG_UNICODE_IO = 1n << 12n;
exports.DFLAG_DIST_HDR_ATOM_CACHE = 1n << 13n;
exports.DFLAG_SMALL_ATOM_TAGS = 1n << 14n;
exports.DFLAG_INTERNAL_TAGS = 1n << 15n;
exports.DFLAG_UTF8_ATOMS = 1n << 16n;
exports.DFLAG_MAP_TAG = 1n << 17n;
exports.DFLAG_BIG_CREATION = 1n << 18n;
exports.DFLAG_SEND_SENDER = 1n << 19n;
exports.DFLAG_BIG_SEQTRACE_LABELS = 1n << 20n;
exports.DFLAG_NO_MAGIC = 1n << 21n;
exports.DFLAG_EXIT_PAYLOAD = 1n << 22n;
exports.DFLAG_FRAGMENTS = 1n << 23n;
exports.DFLAG_HANDSHAKE_23 = 1n << 24n;
exports.DFLAG_V4_NC = 1n << 34n;
exports.DFLAG_ALIAS = 1n << 35n;

const e = exports;
exports.DEFAULT_DFLAGS = (
  e.DFLAG_EXTENDED_REFERENCES
  | e.DFLAG_DIST_MONITOR
  | e.DFLAG_FUN_TAGS
  | e.DFLAG_DIST_MONITOR_NAME
  | e.DFLAG_NEW_FUN_TAGS
  | e.DFLAG_EXTENDED_PIDS_PORTS
  | e.DFLAG_EXPORT_PTR_TAG
  | e.DFLAG_BIT_BINARIES
  | e.DFLAG_NEW_FLOATS
  | e.DFLAG_SMALL_ATOM_TAGS
  | e.DFLAG_UTF8_ATOMS
  | e.DFLAG_MAP_TAG
  | e.DFLAG_BIG_CREATION
  | e.DFLAG_SEND_SENDER
  | e.DFLAG_HANDSHAKE_23
  | e.DFLAG_V4_NC
  | e.DFLAG_ALIAS
);
