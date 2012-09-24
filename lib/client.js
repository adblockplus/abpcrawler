function get(url, callback)
{
  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
      .createInstance(Ci.nsIXMLHttpRequest);
  request.mozBackgroundRequest = true;
  request.open("GET", url);
  if (callback)
    request.addEventListener("load", callback.bind(undefined, request));
  request.send();
}

function postFile(url, window, filePath, callback)
{
  let formData = new window.FormData;
  formData.append("file", new window.File(filePath));

  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
      .createInstance(Ci.nsIXMLHttpRequest);
  request.mozBackgroundRequest = true;
  request.open("POST", url);
  if (callback)
    request.addEventListener("load", callback.bind(undefined, request));
  request.send(formData);
}

let Client = exports.Client = {};

Client.fetchCrawlableSites = function(backendUrl, callback)
{
  get(backendUrl + "/crawlableSites", function(request)
  {
    let sites = request.responseText.trim().split("\n");
    callback(sites);
  });
};

Client.sendCrawlerDataFile = function(backendUrl, window, dataFilePath, callback)
{
  postFile(backendUrl + "/crawlerData", window, dataFilePath, callback);
};
