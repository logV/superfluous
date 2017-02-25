var defaults = require_root("config/config");

module.exports = {
  hostname: 'localhost',
  behind_proxy: false,
  development: true,
  slog: true,
  analytics: _.defaults({ enabled: true, }, defaults.analytics)
};
