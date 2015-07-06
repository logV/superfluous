"use strict";

var load_controller = require_core("server/controller").load;
var context = require_core("server/context");
var bridge = require_core("server/bridge");
var Primus = require("primus.io");
var hooks = require_core("server/hooks");
var domain = require("domain");

var config = require_core("server/config");


var _sockets = [];
var _dirty = false;

var _controller_caches = {};
var _primus = null;

var _socket_id = 0;
function wrap_socket(socket) {
  var d = domain.create();
  d.on('error', function(er) {
    console.error('Caught error!', er);
  });
  d.add(socket);

  _socket_id += 1;

  var ret = {};
  ret.emit = function() {
    if (socket.send) {
      socket.send.apply(socket, arguments);
    } else if (socket.emit) {
      socket.emit.apply(socket, arguments);
    }  else {
      throw new Error("not so sockety");
    }
  };

  ret.send = ret.emit;

  ret.broadcast = {
    emit: function(evt, data) {
      socket.channel.send(evt, data);
    },
    to: function(room) {
      return wrap_socket(socket.room(room));

    }
  };

  ret.on = function(evt, cb) {
    socket.on(evt, cb);
  };

  ret.bridge = {
    call: function() {
      var args = _.toArray(arguments);
      var module = args.shift();
      var func = args.shift();
      ret.emit('__call', module, func,
        bridge.marshall_args.apply(bridge, args));
    },
    controller: function() {
      var args = _.toArray(arguments);
      var module = args.shift();
      var func = args.shift();
      ret.emit('__controller_call', module, func,
        bridge.marshall_args.apply(bridge, args));
    }
  };

  ret.log = function() {
    ret.emit("__log", _.toArray(arguments));
  };

  ret.primus = _primus;
  ret.socket = socket;
  ret.spark = socket;

  // incoming connections have headers
  if (socket.headers) {
    ret.session = socket.headers.session;
    ret.sid = socket.headers.sid;
  }

  // a place to hang some data
  ret.manager = {};
  return ret;

}

function setup_new_socket(controller_cache, name, controller, socket) {
  if (controller.socket) {
    controller.socket(socket);
  }

  _sockets.push(socket);

  _.each(controller_cache, function(v, k) {
    socket.emit('__store', {
      key: k,
      value: v,
      controller: name
    });
  });

  socket.on('__store', function(data) {
    var controller_cache = _controller_caches[data.controller];
    _dirty = true;

    controller_cache[data.key] = data.value;

    // TODO: validate this before sending it to other clients.
    socket.broadcast.emit("__store", data);
  });

  socket.on('__validate_versions', function(versions, cb) {
    var bootloader = require_core("controllers/bootloader/server");
    bootloader.validate_versions(versions, socket, cb);
  });

  socket.on('close', function() {
    _sockets = _.without(_sockets, socket);
  });
}

function get_socket(io, path) {
  return wrap_socket(io.channel(path));
}

module.exports = {
  setup_io: function(app, server) {
    // Setup Socket.IO
    var io;
    var transformer = config.primus_transformer || "engine.io";
    var primus = new Primus(server, {
      transformer: transformer,
    });
    // add rooms to Primus
    _primus = primus;

    this.install(primus);

    var shutdown = require_core('server/shutdown');
    shutdown.install(primus);

    /**
     * auth callback
     *
     * @event auth
     * @param {app} app the express app to add query parsing middleware to
     */
    hooks.setup("socket", app, primus, function() { });

    /**
     * auth callback
     *
     * @event auth
     * @param {app} app the express app to add query parsing middleware to
     */
    hooks.setup("auth", app, primus, function(app, primus) {
      var auth = require_core("server/auth");
      auth.install(app, primus);
    });

    return io;
  },

  get_cache: function(cb) {
    cb(_controller_caches);
  },

  install: function(io) {
    var controllers = require_core("server/controller").get_loaded_controllers();
    _.each(controllers, function(name) {
      var controller = load_controller(name);

      if (!controller.socket) {
        return;
      }

      if (!_controller_caches[name]) {
        _controller_caches[name] = {};
      }
      var controller_cache = _controller_caches[name];

      var controller_socket_path = "ctrl_" + name;
      var controller_socket = get_socket(io, controller_socket_path);
      controller.get_shared_value = function(key) {
        return _controller_caches[name][key];
      };

      // TODO: remove this call and make it deprecated
      controller.get_socket = function() {
        return controller_socket;
      };
      controller.get_channel = controller.get_socket;

      if (controller.realtime) {
        controller.realtime(controller_socket);
      }

      controller_socket.socket.on('connection', function(s) {
        var socket = wrap_socket(s);
        socket.channel = controller_socket;
        socket.controller = name;

        context.create({ socket: socket }, function(ctx) {
          var old_on = socket.on;

          // Wrapping the context forward (or so i think)
          socket.on = function() {
            var args = _.toArray(arguments);
            var last_func = args.pop();
            last_func = context.wrap(last_func);
            args.push(last_func);

            old_on.apply(socket, args);
          };

          try {
            setup_new_socket(controller_cache, name, controller, socket);
          } catch(e) {
            console.log("Couldn't setup socket for new client on", name, "controller", e);
          }
        });

      });
    });
  },
  get_open_sockets: function() {
    return _sockets;
  },
  get_socket_library: function() {
    return _primus.library();
  },
  set_primus: function(primus) {
    _primus = primus;
  },
  wrap_socket: wrap_socket,
  get_primus: function() {
    return _primus;
  }
};
