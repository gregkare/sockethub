var schemas = require('./schemas.js');
var functions = (function() {
  var pub = {};

  pub.ping = function(d, resp) {
    var response = '{}';
    if (typeof d.timestamp) {
      response = '{"response": {"timestamp":"'+d.timestamp+'"}}';
    } else {
      response = '{"response": "invalid json"}';
    }
    resp(response);
  };

  pub.message = function(d, resp) {
    var response = '{}';
    resp(response);
  };
  return pub;
})();

module.exports = {

  "verbs" : { // validate json with these schemas
    "ping" : { "name" : "ping", "schema" : schemas['ping'] },
    "register" : { "name" : "register", "schema" : schemas['register'] },
    "message" : { "name" : "message", "schema" : schemas['message'] }
  },

  "platforms" : {
    "dispatcher" : {
      "name" : "dispatcher",
      "verbs" : {
        "ping": {
          "name" : "ping",
          "func" : functions.ping // if func is set, we dont send to redis queue
        },
        "register" : {
          "name" : "register",
          "func" : function () {}
        }
      }
    },
    "smtp" : {
      "name" : "smtp",
      "verbs" : {
        "message" : {}
      }
    }
  }
};