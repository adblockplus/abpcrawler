/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

"use strict";

/**
 * @module commandLine
 */

const {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});

let CommandLineHandler =
{
  // Starting the entry with "k" makes it have slightly higher priority than default command line handlers.
  classDescription: "k-abpcrawler",
  contractID: "@adblockplus.org/abpcrawler/cmdline;1",
  classID: Components.ID("{973636c2-e842-11e4-b02c-1681e6b88ec1}"),
  xpcom_categories: ["command-line-handler"],

  init: function()
  {
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(this.classID, this.classDescription, this.contractID, this);

    let catMan = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
    for each (let category in this.xpcom_categories)
      catMan.addCategoryEntry(category, this.classDescription, this.contractID, false, true);

    onShutdown.add((function()
    {
      for each (let category in this.xpcom_categories)
        catMan.deleteCategoryEntry(category, this.classDescription, false);

      registrar.unregisterFactory(this.classID, this);
    }).bind(this));
  },

  createInstance: function(outer, iid)
  {
    if (outer)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return this.QueryInterface(iid);
  },

  helpInfo: "  -crawler-port      Port that ABP Crawler should communicate to\n",

  handle: function(cmdline)
  {
    let port = cmdline.handleFlagWithParam("crawler-port", false);
    if (port != null)
      require("main").startup(parseInt(port));
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsICommandLineHandler, Ci.nsIFactory])
};

CommandLineHandler.init();
