"use strict";

var _ = require_vendor("underscore");
var context = require_core("server/context");
var packager = require_core("server/packager");
var Component = require_core("server/component");
var socket = require_core("server/socket");
var readfile = require_core("server/readfile");
var quick_hash = require_core("server/hash");
var config = require_core("server/config");

var async = require("async");
var less = require("less");
var stringify = require("json-stable-stringify");

var PAYLOAD_SEPARATOR = "#$%PAYLOAD^%$";

function multi_pack(dir, extension, prepack) {
  var cache = {};
  return function() {
    var req = context("req");
    var res = context("res");
    var stream = context("stream");

    var streaming = req.query.streaming;

    var loaded = {};
    var modules = JSON.parse(req.query.m);

    function unpack(data, loaded) {
      var just_loaded = {};
      if (_.isObject(data)) {
        _.each(data, function(v, k) {
          if (dir) {
            just_loaded[k.replace(dir + "/", '')] = v;
          } else {
            just_loaded[k] = v;
          }
        });
      } else {
        just_loaded[module] = data;
      }

      _.extend(loaded, just_loaded);

      if (streaming) {
        stream.write(JSON.stringify(just_loaded));
        stream.write(PAYLOAD_SEPARATOR);
        stream.flush();
      }

    }

    if (streaming) {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Encoding", "gzip");
    } else {
      res.setHeader("Content-Type", "application/json");
    }

    async.each(modules, function(module, done) {
      var filename = dir + "/" + module;

      if (cache[module] && config.RELEASE) {
        unpack(cache[module], loaded);
        done();
        return;
      }

      // Does an unwind and prepack, technically
      if (prepack) {
        prepack([filename], function(data) {
          unpack(data, loaded);
          cache[module] = data;
          done();
        });

      } else {
        console.log("No prepack?", extension, module);
      }
    }, function resolution() {
      if (streaming) {
        stream.end();
      } else {
        res.write(JSON.stringify(loaded));
        res.end();
      }
    });
  };
}

var js = multi_pack("", "js", packager.js);
var css = multi_pack("styles", "css", packager.less);
var _js_prelude;
var _css_prelude;
var _socket_lib;

function get_socket_hash(after_read_socket_hash) {
  if (!_socket_lib) {
    _socket_lib = socket.get_socket_library();
  }
  after_read_socket_hash(quick_hash(_socket_lib));
}

function get_socket_library(after_read_socket) {
  if (!_socket_lib) {
    _socket_lib = socket.get_socket_library();
  }
  after_read_socket({ sockets: _socket_lib });
}


function get_js_prelude(after_read_prelude) {
  if (!_js_prelude) {
    _js_prelude = {};
    var data = readfile.core("core/client/prelude.json");

    data = JSON.parse(data);
    var filelist = data.vendor.concat(data.files);

    try {
      var app_data = readfile.app("app/client/prelude.json");
      if (app_data) {
        app_data = JSON.parse(app_data);
        filelist = filelist.concat(app_data.vendor.concat(app_data.files));
      }
    } catch (e) {
      console.log("Couldn't load app prelude", e);
    }

    // The files need to be ordered properly
    async.each(filelist,
      function(item, cb) {
        var data = readfile.both(item);
        var ret = data.toString();
        _js_prelude[item] = ret;

        cb();
      },
      after_read_prelude);
  } else {
    after_read_prelude();
  }
}

function get_css_prelude(after_read_prelude) {
  // Shrink wrap the prelude files
  var data = readfile.core("core/client/prelude.json");

  data = JSON.parse(data);

  var app_data;
  try {
    app_data = readfile.app("app/client/prelude.json");
    if (app_data) {
      app_data = JSON.parse(app_data);
    }
  } catch (e) {
    console.log("Couldn't load app prelude", e);
  }

  var styles_to_load = data.styles;
  if (app_data && app_data.styles) {
    styles_to_load = styles_to_load.concat(app_data.styles);
  }

  if (!_css_prelude) {
    _css_prelude = {};
    async.each(
      styles_to_load,
      function(file, cb) {
        var css_data = readfile(file);
        if (css_data) {
          less.render(css_data, function(err, data) {
            if (!err) {
              if (data.css) {
                data = data.css;
              }
              _css_prelude[file] = data;
            } else {
              console.log("Error lessing", file, ", sending uncompiled version");
              _css_prelude[file] = css_data.toString();
            }
          });
        } else {
          console.log("Error reading", file);
        }

        cb();
      },
      after_read_prelude);
  } else {
    after_read_prelude();
  }

}

function get_js_prelude_hash(cb) {
  get_js_prelude(function() {
    var str = stringify(_js_prelude);
    cb(quick_hash(str));
  });
}

function get_css_prelude_hash(cb) {
  get_css_prelude(function() {
    var str = stringify(_css_prelude);
    cb(quick_hash(str));
  });

}

var write_socket_library = function() {
  // Shrink wrap the prelude files
  var req = context("req");
  var res = context("res");

  res.set("Content-Type", "text/javascript");
  var maxAge = 60 * 1000 * 60 * 24 * 365;
  if (!res.getHeader('Cache-control')) {
    res.setHeader('Cache-control', 'public, max-age=' + (maxAge / 1000));
  }


  get_socket_library(function after_read_prelude() {
    res.write(_socket_lib);
    res.end();
  });
};

var write_js_prelude = function() {
  // Shrink wrap the prelude files
  var req = context("req");
  var res = context("res");

  res.set("Content-Type", "text/javascript");
  var maxAge = 60 * 1000 * 60 * 24 * 365;
  if (!res.getHeader('Cache-control')) {
    res.setHeader('Cache-control', 'public, max-age=' + (maxAge / 1000));
  }


  get_js_prelude(function after_read_prelude(err) {
    _.each(_js_prelude, function(data, file) {
      res.write(_js_prelude[file]);
    });
    res.end();
  });

};

var get_status = function() {
  var res = context("res");
  res.write("OK");
  res.end();
};

var write_css_prelude = function() {
  var res = context("res");

  res.set("Content-Type", "text/css");
  var maxAge = 60 * 1000 * 60 * 24 * 365;
  if (!res.getHeader('Cache-control')) {
    res.setHeader('Cache-control', 'public, max-age=' + (maxAge / 1000));
  }

  get_css_prelude(function after_read_prelude(err) {
    _.each(_css_prelude, function(data, file) {
      var prelude_data = _css_prelude[file];
      if (_.isString(prelude_data)) {
        res.write(prelude_data);
      }
    });
    res.end();
  });
};

var component = function() {
  var req = context("req");
  var res = context("res");

  var loaded = {};

  var modules = JSON.parse(req.query.m);
  async.each(
    modules,
    function(module, cb) {
      Component.build_package(module, function(ret) {
       loaded[module] = ret;
       cb();
      });
    }, function(err, results) {
      res.set("Content-Type", "application/json");

      res.end(JSON.stringify(loaded));
    });
};

function validate_versions(versions, socket, cb) {
  cb = cb || function() { };
  function stylename(css) {
    return "styles/" + css;
  }
  var named_styles = _.map(versions.css, function(old_hash, css) {
    return stylename(css);
  });

  packager.less(named_styles, function(ret) {
    _.each(versions.css, function(old_hash, css) {
      var mod = stylename(css);
      if (ret[mod]) {
        if (ret[mod].signature !== old_hash) {
          console.log("Updating version", "css", old_hash, ret[mod].signature);
          socket.emit("__update_version", 'css', css, old_hash, ret[mod].signature);
        }
      } else {
        socket.emit("__update_version", 'css', css, old_hash, null);
      }
    });
  });

  packager.js(_.keys(versions.js), function(ret) {
    _.each(versions.js, function(old_hash, js) {
      if (ret[js]) {
        if (ret[js].signature !== old_hash) {
          socket.emit("__update_version", 'js', js, old_hash, ret[js].signature);
        }
      } else {
        socket.emit("__update_version", 'js', js, old_hash, null);
      }
    });
  });

  if (!versions.component) {
    return cb();
  }

  var after = _.after(_.keys(versions.component).length, cb);
  _.each(versions.component, function(old_hash, pkg) {
    Component.build_package(pkg, function(ret) {
      if (!ret) {
        socket.emit("__update_version", 'component', pkg, old_hash, null);
        return;
      }

      if (old_hash !== ret.signature) {
        socket.emit("__update_version", 'component', pkg, old_hash, ret.signature);
      }

      after();
    });
  });
}

function add_packaging_endpoint(endpoint, handler) {
  module.exports.routes["/" + endpoint] = "handle_" + endpoint;
  module.exports["handle_" + endpoint] = handler;
}

module.exports = {
  js: js,
  css: css,
  get_socket_hash: get_socket_hash,
  get_js_prelude_hash: get_js_prelude_hash,
  get_css_prelude_hash: get_css_prelude_hash,
  write_js_prelude: write_js_prelude,
  write_css_prelude: write_css_prelude,
  write_socket_library: write_socket_library,
  component: component,
  get_status: get_status,
  validate_versions: validate_versions,
  add_packaging_endpoint: add_packaging_endpoint,

  routes: {
    "/status" : "get_status",
    "/css" : "css",
    "/js" : "js",
    "/component" : "component",
    "/prelude.js" : "write_js_prelude",
    "/prelude.css" : "write_css_prelude",
    "/socket" : "write_socket_library"
  }
};
