#!/usr/bin/env python
# coding: utf-8

import argparse
import os
import json
import urllib2
import time
import sys
import psutil

from Queue import Queue
from threading import Thread

def get_file_size(url, proxy=None):
    """get file size from content-length of heads
    url - target file url
    proxy - proxy
    """
    opener = urllib2.build_opener()
    if proxy:
        if url.lower().startswith('https://'):
            opener.add_handler(urllib2.ProxyHandler({'https' : proxy}))
        else:
            opener.add_handler(urllib2.ProxyHandler({'http' : proxy}))
    request = urllib2.Request(url)
    request.add_header('User-agent', 'Mozilla/5.0 (Linux; U; Android 2.3.3; en-us ;'
                                     ' LS670 Build/GRI40) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0'
                                     ' Mobile Safari/533.1/UCBrowser/8.6.1.262/145/355')
    #request.get_method = lambda: 'HEAD'
    try:
        response = opener.open(request)
        html = response.read()
    except Exception, e:
        print >> sys.stderr, '%s %s' % (url, e)
        return 0
    else:
        #html_size = int(dict(response.headers).get('content-length', 0))
        html_size = len(html)
        return html_size

class UrlSizeGetterWorker(Thread):
    """
    The class of image downloading thread
    Function:
        __init__():initialization of threading
        run:the running of threading
    """
    def __init__(self, queue, info_dict):
        Thread.__init__(self)
        self.queue = queue
        self.info_dict = info_dict

    def run(self):
        while True:
            url = self.queue.get()
            if not self.info_dict[url]:
                size = get_file_size(url)
                self.info_dict[url] = size
            self.queue.task_done()

class Analyser:
    def __init__(self, parameters):
        self.parameters = parameters
        self.filters = {'blocking': {},
                        'elemhide': {}}
        self.blockurls = {}
        self.totalsize = 0

    def analyse(self):
        self.__walk_dir(self.parameters.outdir, self.__analyse_item)

    def print_filters(self):
        counts = {'blocking': 0,
                  'elemhide': 0}

        queue = Queue()
        # start cpu core'number double threads
        for x in range(psutil.cpu_count() * 2):
            worker = UrlSizeGetterWorker(queue, self.blockurls)
            worker.setDaemon(True)
            worker.start()
        # traverse the links and put the link to queue
        for url in self.blockurls.keys():
            queue.put(url)
        # the new queue joining
        queue.join()

        print "规则匹配命中次数:"
        for filter_type in self.parameters.filter_types:
            for k, v in self.filters[filter_type].items():
                counts[filter_type] += v
                print "%s\t%d" %(k, v)

        print "\n被阻塞拦截的资源请求:"
        for url, size in self.blockurls.items():
            self.totalsize += size
            type = "script"
            if ".jpg" in url or ".gif" in url or ".png" in url or ".svg" in url \
                or ".jpeg" in url or ".bmp" in url:
                type = "image"
            elif ".css" in url or ".woff" in url:
                type = "style"
            print "%s\t%d\t%s" %(type, size, url)

        print "\n过滤总体情况"
        print "counts: all[%d] blocking[%d] elemhide[%d] savesize[%d]" %(counts['blocking'] + counts['elemhide'],
                                        counts['blocking'], counts['elemhide'], self.totalsize / len(self.blockurls))

    def __walk_dir(self, dir, function, exclude = ''):
        excludelist = []
        if exclude:
            excludelist = exclude.split(',')
        files = os.listdir(dir)
        files.sort()
        if not dir.endswith(os.sep):
            dir = dir + os.sep
        for item in files:
            fullpath = dir + item
            if os.path.isdir(fullpath):
                if item not in excludelist:
                    self.__walk_dir(fullpath, function, exclude)
            else:
                filename = dir + item
                if function:
                    function(filename)

    def __analyse_item(self, filename):
        if not filename.endswith(".json"):
            return

        json_file = file(filename)
        data = json_file.read()
        result = json.loads(data)

        if not result.has_key('requests'):
            return

        for filter_item in result['requests']:
            filter = filter_item['filter']
            if filter:
                if filter_item['contentType'] == 'ELEMHIDE':
                    count = self.filters['elemhide'].get(filter, 0)
                    self.filters['elemhide'][filter] = count + 1
                else:
                    count = self.filters['blocking'].get(filter, 0)
                    self.filters['blocking'][filter] = count + 1
                    self.blockurls[filter_item['location']] = 0


def main():
    parser = argparse.ArgumentParser(description='Analyse results')
    parser.add_argument(
        '-f', '--filter-types', metavar='url', type=str, nargs='+',
        default=["blocking", "elemhide"],
        help='filter type lists to print results'
    )
    parser.add_argument(
        'outdir', type=str,
        help='directory to read data into'
    )
    parameters = parser.parse_args()

    for item in parameters.filter_types:
        if item not in ['blocking', 'elemhide']:
            print 'filter types invalidate, must be in blocking and elemhide'

    analyser = Analyser(parameters)
    analyser.analyse()
    analyser.print_filters()


if __name__ == '__main__':
    main()
