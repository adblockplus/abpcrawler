abpcrawler
==========

Firefox extension that loads a range of websites and records which
elements are filtered by [Adblock Plus](http://adblockplus.org).

Requirements
------------

* [Mercurial](https://www.mercurial-scm.org/) or [Git](https://git-scm.com/) (whichever you used to clone this repository)
* [Python 2.x](https://www.python.org)
* [The Jinja2 module](http://jinja.pocoo.org/docs)
* [mozrunner module](https://pypi.python.org/pypi/mozrunner)

Running
-------

Execute the following:

    ./run.py -b /usr/bin/firefox urls.txt outputdir

This will run the specified Firefox binary to crawl the URLs from `urls.txt`
(one URL per line). The resulting data and screenshots will be written to the
`outputdir` directory. Firefox will close automatically once all URLs have been
processed.

Optionally, you can provide the path to the Adblock Plus repository - Adblock
Plus will no longer be downloaded then.

Analysing
-------

Execute the following:

    ./analyse.py outputdir > results.txt

This will read the ;outputdir' directory and analyse the results, give a breif
of the adblock informaition.


License
-------

This Source Code is subject to the terms of the Mozilla Public License
version 2.0 (the "License"). You can obtain a copy of the License at
http://mozilla.org/MPL/2.0/.
