abpcrawler
==========

Firefox extension that loads a range of websites and records which
elements are filtered by [Adblock Plus](http://adblockplus.org).

Building
--------

Make sure you have:

* A running Firefox with Adblock Plus and
  [Extension Auto Installer](https://addons.mozilla.org/en-US/firefox/addon/autoinstaller/)
  installed.
* Python 2.7

Then execute the following:

    ./build.py autoinstall 8888

This will install the extension into the running Firefox, or update it
if it was already installed.

Usage
-----

Make sure that Adblock Plus is enabled, then click on the ABP symbol in the extension bar and on _Adblock Plus Crawler_.

Now enter the backend URL and hit _Crawl_.

License
-------

This Source Code is subject to the terms of the Mozilla Public License
version 2.0 (the "License"). You can obtain a copy of the License at
http://mozilla.org/MPL/2.0/.
