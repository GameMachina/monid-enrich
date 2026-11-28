// Node's React server condition selects React's server-only export, which omits APIs used by Next's test imports.
// Production builds enforce this marker; Node tests import server modules directly and need a harmless marker module.
