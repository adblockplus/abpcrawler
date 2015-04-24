#!/usr/bin/env python
# coding: utf-8

import argparse
import datetime
import errno
import hashlib
import io
import json
import os
import random
import subprocess
import sys
import tempfile
import threading
import urllib
import urlparse
from wsgiref.simple_server import make_server

from mozprofile import FirefoxProfile
from mozrunner import FirefoxRunner

class CrawlerApp:
  server = None
  def __init__(self, parameters):
    self.parameters = parameters
    with io.open(self.parameters.list, 'r', encoding='utf-8') as handle:
      self.urls = map(unicode.strip, handle.readlines())

  def __call__(self, environ, start_response):
    path = environ.get('PATH_INFO', '')
    if path == '/parameters':
      start_response('200 OK', [('Content-Type', 'application/json')])
      return [json.dumps({
        'urls': self.urls,
        'timeout': self.parameters.timeout * 1000,
        'maxtabs': self.parameters.maxtabs,
      })]
    elif path == '/save':
      try:
        request_body_size = int(environ.get('CONTENT_LENGTH', 0))
      except (ValueError):
        start_response('400 Bad Request', [])
        return ''

      data = json.loads(environ['wsgi.input'].read(request_body_size))
      self.urls.remove(data['url'])

      parsedurl = urlparse.urlparse(data['url'])
      urlhash = hashlib.new('md5', data['url']).hexdigest()
      timestamp = datetime.datetime.fromtimestamp(data['startTime'] / 1000.0).strftime('%Y-%m-%dT%H%M%S.%f')
      basename = "%s-%s-%s" % (parsedurl.hostname, timestamp, urlhash)
      datapath = os.path.join(self.parameters.outdir, basename + ".json")
      screenshotpath = os.path.join(self.parameters.outdir, basename + ".jpg")
      sourcepath = os.path.join(self.parameters.outdir, basename + ".xml")

      try:
        os.makedirs(self.parameters.outdir)
      except OSError as e:
        if e.errno != errno.EEXIST:
          raise

      if "screenshot" in data:
        with open(screenshotpath, 'wb') as handle:
          handle.write(urllib.urlopen(data["screenshot"]).read())
        del data["screenshot"]

      if "source" in data:
        with io.open(sourcepath, 'w', encoding='utf-8') as handle:
          handle.write(data["source"])
        del data["source"]

      with io.open(datapath, 'w', encoding='utf-8') as handle:
        handle.write(unicode(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True)) + u'\n')
      start_response('204 No Content', [])
      return ''

    start_response('404 Not Found', [])
    return ''

def run():
  parser = argparse.ArgumentParser(description='Run crawler')
  parser.add_argument(
    '-b', '--binary', type=str,
    help='path to the Firefox binary'
  )
  parser.add_argument(
    '-a', '--abpdir', type=str,
    help='path to the Adblock Plus repository'
  )
  parser.add_argument(
    '-f', '--filters', metavar='url', type=str, nargs='+',
    default=["https://easylist-downloads.adblockplus.org/easylist.txt", "https://easylist-downloads.adblockplus.org/exceptionrules.txt"],
    help='filter lists to install in Adblock Plus. The arguments can also have the format path=url, the data will be read from the specified path then.'
  )
  parser.add_argument(
    '-t', '--timeout', type=int, default=300,
    help='Load timeout (seconds)'
  )
  parser.add_argument(
    '-x', '--maxtabs', type=int, default=15,
    help='Maximal number of tabs to open in parallel'
  )
  parser.add_argument(
    'list', type=str,
    help='URL list to process'
  )
  parser.add_argument(
    'outdir', type=str,
    help='directory to write data into'
  )
  parameters = parser.parse_args()

  import buildtools.packagerGecko as packager
  cleanup = []
  try:
    base_dir = os.path.dirname(__file__)
    handle, crawlerxpi = tempfile.mkstemp(suffix='.xpi')
    os.close(handle)
    cleanup.append(crawlerxpi)
    packager.createBuild(base_dir, outFile=crawlerxpi, releaseBuild=True)

    abpxpi = 'https://addons.mozilla.org/firefox/downloads/latest/1865/addon-1865-latest.xpi'
    if parameters.abpdir:
      handle, abpxpi = tempfile.mkstemp(suffix='.xpi')
      os.close(handle)
      cleanup.append(abpxpi)
      packager.createBuild(parameters.abpdir, outFile=abpxpi, releaseBuild=True)

    profile = FirefoxProfile(
      addons=[
        crawlerxpi,
        abpxpi,
      ],
      preferences={
        'browser.uitour.enabled': False,
        'prompts.tab_modal.enabled': False,
      }
    )

    abpsettings = os.path.join(profile.profile, 'adblockplus')
    os.makedirs(abpsettings)
    with open(os.path.join(abpsettings, 'patterns.ini'), 'w') as handle:
      print >>handle, '# Adblock Plus preferences'
      print >>handle, 'version=4'
      for url in parameters.filters:
        if '=' in url:
          path, url = url.split('=', 1)
          with open(path, 'r') as source:
            data = source.read()
        else:
          data = urllib.urlopen(url).read()
        print >>handle, '[Subscription]'
        print >>handle, 'url=%s' % url
        print >>handle, '[Subscription filters]'
        print >>handle, '\n'.join(data.splitlines()[1:])
  finally:
    for path in cleanup:
      os.unlink(path)

  server = None
  try:
    port = random.randrange(2000, 60000)
    print "Communicating with client on port %i" % port

    app = CrawlerApp(parameters)
    server = make_server('localhost', port, app)
    app.server = server
    threading.Thread(target=lambda: server.serve_forever()).start()

    runner = FirefoxRunner(
      profile=profile,
      binary=parameters.binary,
      cmdargs=['--crawler-port', str(port)],
      env=dict(os.environ, MOZ_CRASHREPORTER_DISABLE='1'),
    )
    while app.urls:
      runner.start()
      runner.wait()
  finally:
    if server:
      server.shutdown()
    profile.cleanup()

if __name__ == '__main__':
  BASE_DIR = os.path.dirname(os.path.abspath(__file__))
  DEPENDENCY_SCRIPT = os.path.join(BASE_DIR, "ensure_dependencies.py")

  try:
    subprocess.check_call([sys.executable, DEPENDENCY_SCRIPT, BASE_DIR])
  except subprocess.CalledProcessError as e:
    print >>sys.stderr, e
    print >>sys.stderr, "Failed to ensure dependencies being up-to-date!"

  run()
