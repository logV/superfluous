"use strict";

require("app/static/vendor/react/react");
require("core/client/backbone");
var _reacts = window.bootloader.reacts;

var _reacts = {};
var _definitions = {};
function define_react(component, definition) {
  var first_define = !_reacts[component];

  if (!definition.schema.no_redefine || first_define) {
    var schema = JSON.parse(definition.schema);
    definition.schema = schema;
    _reacts[component] = window.bootloader.raw_import(definition.main, "react/" + component + "/" + component);
    _definitions[component] = definition;
      
    if (definition.style) {
      window.bootloader.inject_css(definition.style);
    }
  }

  return _reacts[component];
}

var _components = {};
var _pending = {};
function register_component(id, instance) {
  _components[id] = instance;
  if (_pending[id]) {
    _.each(_pending[id], function(cb) {
      cb(instance);
    });
    delete _pending[id];
  }
}

function get_component(id, cb) {
  if (!_components[id]) {
    _pending[id] = _pending[id] || [];
    _pending[id].push(cb);
  } else {
    cb(_components[id]);
  }
}

window.bootloader.register_component_packager("react", _reacts, define_react);
window.bootloader.add_marshaller("react", function(arg, cb) {
  if (arg && arg.isReact) {
    get_component(arg.id, function(cmp) {
      cb(cmp);
    });
    return true;
  }

});

function init_react_component(el, instance) {

  function do_component_render() {
    window.React.renderComponent(instance, el);

    if (instance.client) {
      instance.client();
    }
  }

  if (instance.client_init) {
    if (!instance.client_init(do_component_render)) {
      do_component_render();
    }
  } else {
    do_component_render();
  }

}

module.exports = {
  instantiate: function(component, options) {
    // gotta require that react component, somehow
    window.bootloader.react(component, function() {
      if (_reacts[component]) {
        window.bootloader.css(_definitions[component].schema.styles, function() {
          var el = window.document.getElementById(options.id);
          var instance = new _reacts[component](options);
          init_react_component(el, instance);
          register_component(options.id, instance);
        });
      }
    });
  },
  build: function(component, options, callback) {
    window.bootloader.react(component, function() {
      var div = $("<div />");
      if (_reacts[component]) {
        window.bootloader.css(_definitions[component].schema.styles, function() {
          var instance = new _reacts[component](options, { });
          init_react_component(div[0], instance);
          register_component(options.id, instance);
          callback({
            $el: div
          });
        });
      }
    });
  }
};

window.$R = module.exports.build;
