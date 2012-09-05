/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

function init()
{
  Application.console.log("init");
}

function destroy()
{
  Application.console.log("destroy");
}

function onLoad(callback)
{
  let progressListener =
  {
    onStateChange: function(aBrowser, aWebProgress, aRequest, aStateFlags, aStatus)
    {
      if (aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_STOP && aStatus === 0)
      {
        window.opener.gBrowser.removeTabsProgressListener(progressListener);
        callback();
      }
    }    
  }

  window.opener.gBrowser.addTabsProgressListener(progressListener);
}

function crawl()
{
  let prefs = Components.classes["@mozilla.org/preferences-service;1"]
      .getService(Components.interfaces.nsIPrefService)
      .getBranch("extensions.adblockplus.");

  prefs.setBoolPref("enabled", false);
  // TODO: Don't hard code the site
  let tab = window.opener.gBrowser.addTab("http://www.heise.de");
  onLoad(function()
  {
    prefs.setBoolPref("enabled", true);
    window.opener.gBrowser.reloadTab(tab);
    onLoad(function()
    {
      // TODO: Compare the downloaded elements with and without ABP
      //       to determine the blocked elements. Then display them.
      window.opener.gBrowser.removeTab(tab);    
    });
  });
}
