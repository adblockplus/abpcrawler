/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @module main
 */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

require("commandLine");
let {run} = require("crawler");

let baseURL = null;

/**
 * Waits for the application to initialize.
 */
let sessionObserver = {
  applicationReady: false,
  callback: null,
  observe: function(subject, topic, data)
  {
    Services.obs.removeObserver(this, "sessionstore-windows-restored");
    this.applicationReady = true;
    if (this.callback)
      this.callback();
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};

Services.obs.addObserver(sessionObserver, "sessionstore-windows-restored", true);
onShutdown.add(function(){
  Services.obs.removeObserver(sessionObserver, "sessionstore-windows-restored");
});

/**
 * Startup function, called from command line handler.
 *
 * @param {int} port  Port to communicate with
 */
function startup(port)
{
  baseURL = "http://localhost:" + port + "/";

  let request = new XMLHttpRequest();
  request.open("GET", baseURL + "parameters");
  request.addEventListener("load", onParametersLoaded, false);
  request.addEventListener("error", onParametersFailed, false);
  request.responseType = "json";
  request.send();
}
exports.startup = startup;

/**
 * Called if parameters loaded succesfully.
 *
 * @param {Event} event
 */
function onParametersLoaded(event)
{
  let {urls, timeout, maxtabs} = event.target.response;

  let callback = function()
  {
    let window = Services.wm.getMostRecentWindow("navigator:browser");
    run(window, urls, timeout, maxtabs, baseURL + "save", function()
    {
      Services.startup.quit(Services.startup.eAttemptQuit);
    });
  };
  if (sessionObserver.applicationReady)
    callback();
  else
    sessionObserver.callback = callback;
}

/**
 * Called if requesting parameters failed.
 *
 * @param {Event} event
 */
function onParametersFailed(event)
{
  Cu.reportError("Failed loading parameters");
}
