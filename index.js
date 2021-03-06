var crypto = require("crypto");
var request = require("request");
var util = require("util");
var EventEmitter = require("events");

const COLLECTOR_URL = "https://metrics-api.iopipe.com"

function make_generateLog(emitter, func, start_time) {
  return function generateLog(err) {
    var hash = crypto.createHash('sha256');
    hash.update(func.toString());
    var function_id = hash.digest('hex')

    var runtime_env = {
      nodejs: {
        title: process.title,
        version: process.version,
        modulesloadList: process.modulesloadList,
        versions: process.versions,
        arch: process.arch,
        platform: process.platform,
        argv: process.argv,
        execArgv: process.execArgv,
        env: process.env,
        pid: process.pid,
        features: process.features,
        execPath: process.execPath,
        debugPort: process.debugPort,
        _maxListeners: process._maxListeners,
        config: process.config,
        maxTickDepth: process.maxTickDepth,
        // /* Circular ref */ mainModule: process.mainModule,
        release: process.release,
        code: func.toString()
      }
    }

    var retainErr;
    if (err) {
      retainErr = { name: err.name,
                    message: err.message,
                    stack: err.stack,
                    lineNumber: err.lineNumber,
                    columnNumber: err.columnNumber,
                    fileName: err.fileName
                  }
    }

    var qfuncs = ["uptime", "getuid", "getgid", "geteuid", "getegid", "memoryUsage"]
    for (var i = 0; i < qfuncs.length; i++) {
      // Lacking a process.prototype, evil eval.
      runtime_env.nodejs[qfuncs[i]] = eval("process."+qfuncs[i]+"()")
    }

    var time_sec_nanosec = process.hrtime(start_time)
    var time_secs = time_sec_nanosec[0]
    var time_nanosecs = time_sec_nanosec[1]

    request(
      {
        url: COLLECTOR_URL,
        method: "POST",
        json: true,
        body: {
          function_id: function_id,
          environment: runtime_env,
          errors: retainErr,
          events: emitter.queue,
          time_sec_nanosec: time_sec_nanosec,
          time_sec: time_sec_nanosec[0],
          time_nanosec: time_sec_nanosec[1],
        },
      },
      function(data, err) {
        console.log("data: " + JSON.stringify(data))
        console.log("err: " + JSON.stringify(err))
      }
    )
  }
}

function agentEmitter() {
  this.queue = []
  EventEmitter.call(this);
}
util.inherits(agentEmitter, EventEmitter)

module.exports = function(func) {
  return function() {
    var emitter = new agentEmitter()
    emitter.on("iopipe_event", (type, data) => {
      emitter.queue.push([type, data])
    })

    var start_time = process.hrtime()
    var generateLog = make_generateLog(emitter, func, start_time)
    var args = [].slice.call(arguments)
    try {
      var ret = func.apply(emitter, args)
    }
    catch (err) {
      generateLog(err)
      throw err
    }

    generateLog()
    return ret
  }
}
