/**
 * This file is part of sockethub.
 *
 * copyright 2012-2013 Nick Jennings (https://github.com/silverbucket)
 *
 * sockethub is licensed under the AGPLv3.
 * See the LICENSE file for details.
 *
 * The latest version of sockethub can be found here:
 *   git://github.com/sockethub/sockethub.git
 *
 * For more information about sockethub visit http://sockethub.org/.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

if (typeof(FeedParser) !== 'object') {
  FeedParser = require('feedparser');
}
if (typeof(request) !== 'object') {
  request = require('request');
}
var Q = require('q');

/**
 * Class: Feeds
 *
 * Handles all actions related to fetching feeds.
 *
 * Current supported feed types:
 *
 * - RSS (1 & 2)
 *
 * - Atom
 *
 * Uses the `node-feedparser` module as a base tool fetching feeds.
 *
 * https://github.com/danmactough/node-feedparser
 *
 */
function Feeds() {
  this.schema = {};
  this.session = {};
  this.sessionId = '';
  this.abort = false;
  return this;
}

//
// sends a set number/range of articles based on the config
Feeds.prototype._sendArticles = function (articles, cfg) {
  var session = this.session;

  if (cfg.from === 'after') {
    articles.sort(function (a, b) {
      return a.object.datenum - b.object.datenum;
    });
  } else {
    articles.sort(function (a, b) {
      return b.object.datenum - a.object.datenum;
    });
  }

  var prop;
  if (cfg.property && (cfg.property === 'url')) {
    prop = 'url';
  } else {
    // default to date
    prop = 'datenum';
  }

  var startSending = false;
  var count = 1;
  for (var i = 0, len = articles.length; i < len; i = i + 1) {
    if (startSending) {
      if (count < cfg.limit) {
        session.send(articles[i]);
        count = count + 1;
      } else {
        return;
      }
    } else if (articles[i].object[prop] === cfg[prop]) {
      // either the date or url matches, return the next cfg.limit articles
      startSending = true;
    } else {
      // console.log('article title: ' + articles[i].object.title + ' d:' + articles[i].object.datenum + ' ' + cfg[prop]);
      if ((cfg.from === 'after') &&
          ((cfg[prop] === 0) ||
           (articles[i].object[prop] >= cfg[prop]))) {
        session.send(articles[i]);
        count = count + 1;
        startSending = true;
      } else if ((cfg.from === 'before') &&
                 ((cfg[prop] === 0) ||
                  (articles[i].object[prop] <= cfg[prop]))) {
        session.send(articles[i]);
        count = count + 1;
        startSending = true;
      }
    }
  }
};


/*
 * setting defaults and normalizing
 */
function parseConfig(options) {
  var cfg = {};
  cfg.limit = (options.limit) ? options.limit : 10;
  cfg.datenum = 0;
  if ((!cfg.property) || (cfg.property === 'date')) {
    try {
      cfg.after_datenum  = (typeof options.after  === 'string') ? Date.parse(options.after)  : (typeof options.after  === 'number') ? options.after  : 0;
    } catch (e) {
      return 'invalid date string passed: ' + options.date + ' - ' + e;
    }
    try {
      cfg.before_datenum = (typeof options.before === 'string') ? Date.parse(options.before) : (typeof options.before === 'number') ? options.before : 0;
    } catch (e) {
      return 'invalid date string passed: ' + options.date + ' - ' + e;
    }
  }
  cfg.url = (options.url) ? options.url : null;
  cfg.from = 'after';
  if ((options.from) && (options.from === 'before')) {
    cfg.from = 'before';
  }
  return cfg;
}

//
// fetches the articles from a feed, adding them to an array
// for processing
Feeds.prototype._fetchFeed = function (url, options, errorObj, successObj) {
  if (this.abort) {return;}
  var q = Q.defer();
  var articleLinks = [];
  var error = false;
  var completed = false;
  var articles = []; // queue of articles to buffer and filter before sending out.
  var session = this.session;
  var self = this;

  var cfg = parseConfig(options);
  if (typeof cfg === 'string') {
    q.reject(cfg);
    return q.promise;
  }

  session.info('issuing request');
  session.debug('FEED URL: ' + url);

  var actor;
  try {
    request(url)

    .on('error', function (e) {
      if (self.abort) {return;}
      session.error('[on] failed to fetch feed from url: '+ url+ ' : '+e.toString());
      error = e.toString();
      q.reject(error);
    })

    .pipe(new FeedParser())

    .on('error', function (e) {
      if (self.abort) {return;}
      session.error('[on] failed to fetch feed from url: '+ url+ ' : '+e.toString());
      error = e.toString();
    })

    .on('meta', function(meta) {
      if (self.abort) {return;}
      session.debug('received feed: ' + meta.title);
      actor = {
        objectType: 'feedChannel',
        name: (meta.title) ? meta.title : (meta.link) ? meta.link : url,
        address: url,
        description: (meta.description) ? meta.description : '',
        image: (meta.image) ? meta.image : {},
        favicon: (meta.favicon) ? meta.favicon : '',
        categories: (meta.categories) ? meta.categories : [],
        language: (meta.language) ? meta.language : '',
        author: (meta.author) ? meta.author : ''
      };
    })

    .on('readable', function () {
      if (self.abort) {return;}
      var stream = this, item;
      while (item = stream.read()) {
        var article = {
          actor: {
            name: actor.name,
            address: actor.address,
            description: actor.description,
            image: actor.image,
            favicon: actor.favicon,
            categories: actor.categories,
            language: actor.language,
            author: actor.author
          },
          target: successObj.target,
          status: true,
          verb: "post",
          object: {
            objectType: 'feedEntry'
          }
        };
        var datenum;
        try {
          datenum = Date.parse(item.date) || 0;
        } catch (e) {
          datenum = 0;
        }
        article.object.title = item.title;
        article.object.date = item.date;
        article.object.datenum = datenum;
        article.object.tags = item.categories;
        article.object.text = item.summary;
        article.object.html = item.summary;
        article.object.brief_text = item.description;
        article.object.brief_html = item.description;
        article.object.link = item.origlink || item.link;
        article.object.media = item.enclosures;
        article.object.source = item.source;

        // add to articles queue
        articles.push(article);
        articleLinks.push(item.link);
      }
    })

    .on('end', function () {
      completed = true;
      if (self.abort) {return;}
      if (error) {
        console.log("ERROR");
        q.reject(error);
      } else {
        session.info("feed fetching successful. completed.");

        self._sendArticles(articles, cfg);
        q.resolve({
          totalArticles: articleLinks.length,
          articleLinks: articleLinks
        });
      }
    });

  } catch (e) {
    if (self.abort) {return;}
    session.log('[try] failed to fetch feed from url: '+ url+ ' : '+e.toString());
    errorObj.target[0] = { address: url};
    errorObj.message = e.toString();
    session.send(errorObj);
    q.reject('failed to fetch feed from url: '+ url+ ' : '+e.toString());
  }
  return q.promise;
};


Feeds.prototype.init = function (sess) {
  this.session = sess;
  this.sessionId = sess.getSessionID();
  var q = Q.defer();
  q.resolve();
  return q.promise;
};


/**
 * Function: fetch
 *
 * Fetches feeds from specified source.
 *
 * Parameters:
 *
 *   job - Activity streams object containing job data:
 *
 * Exmaple:
 *
 *      (start code)
 *      {
 *        actor: {
 *          address: 'feeds'
 *        },
 *        rid: '1234',
 *        verb: "fetch",
 *        target: [
 *          {
 *            address: '[feed_url]'
 *          },
 *          ...
 *        ],
 *        object: {
 *          limit: 10,    // default 10
 *          property: 'date'
 *          after: 'Tue Nov 26 2013 02:11:59 GMT+0100 (CET)',
 *
 *          // ... OR ...
 *
 *          property: 'link',
 *          after: 'http://www.news.com/articles/man-eats-car',
 *        }
 *      }
 *      (end code)
 *
 *
 *         Without any properties specified, the platform will return most
 *         recent 20 articles fetched from the feed.
 *
 * Returns:
 *
 *   Sends back a message with an AS object for each article, and upon
 *   completion it will send back a response to the original request with a
 *   complete list of URLs in the feed and total count.
 *
 * Example returned object:
 *
 *   (start code)
 *   {
 *     actor: {
 *       objectType: 'feedChannel',
 *       name: 'Best Feed Inc.',
 *       address: 'http://example.com/rss',
 *       description: 'Where the best feed comes to be the best',
 *       image: {
 *         width: '144',
 *         height: '144',
 *         url: 'http://example.com/images/bestfeed.jpg',
 *       }
 *       favicon: 'http://example.com/favicon.ico',
 *       categories: ['best', 'feed', 'aminals'],
 *       language: 'en',
 *       author: 'John Doe'
 *     },
 *     target: [
 *       {
 *         address: 'feeds'
 *       }
 *     ],
 *     status: true,
 *     verb: 'post',
 *     object: {
 *       objectType: 'feedEntry',
 *       title: 'About stuff...',
 *       date: "2013-05-28T12:00:00.000Z",
 *       datenum: 1369742400000,
 *       brief_html: "Brief synopsis of stuff...",
 *       brief_text: "Brief synopsis of stuff...",
 *       html: "Once upon a time...",
 *       text: "Once upon a time..."
 *       link: "http://example.com/articles/about-stuff"
 *       media: [
 *         {
 *           length: '13908973',
 *           type: 'audio/mpeg',
 *           url: 'http://example.com/media/thing.mpg'
 *         }
 *       ]
 *       tags: ['foo', 'bar']
 *     }
 *   }
 *   (end code)
 *
 */
Feeds.prototype.fetch = function (job) {
  var q = Q.defer();
  var self = this;

  var errorObj = { // preset obj for failed fetches
    verb: 'fetch',
    actor: {
      address: job.actor.addres
    },
    target: [],
    status: false,
    message: ''
  };

  var successObj = { // preset obj for success fetches
    verb: 'add',
    actor: {
      name: '',
      address: '',
      description: ''
    },
    target: [{ address: job.actor.address}],
    status: true,
    object: {
      title: '',
      date: '',
      tags: '',
      text: '',
      html: '',
      brief_text: '',
      brief_html: '',
      link: ''
    }
  };

  var jobs = 0;
  var completed = 0;
  var completedObj = {};

  function jobCompleted (url, result) {
    completed = completed + 1;
    completedObj[url] = result;
    if (jobs === completed) {
      q.resolve(completedObj);
    }
  }

  function jobFailed (url, err) {
    completed = completed + 1;
    completedObj[url] = err;
    if (jobs === completed) {
      q.reject(err, completedObj);
    }
  }

  function runJob (url, options) {
    self._fetchFeed(url, options, errorObj, successObj)
      .then(function (obj) {
        jobCompleted(url, obj);
      }, function (err) {
        jobFailed(url, err);
      });
  }

  if (typeof job.target !== 'object') {
    q.reject('no target specified');
  } else if (typeof job.target[0] === 'undefined') {
    q.reject('invalid target array');
  } else if (typeof job.target[0].address === 'undefined') {
    q.reject('no address found in first target object');
  } else {
    // ready to execute job

    // a job may complete before the next loop if there's an error, so
    // lets count the jobs before we process them...
    for (var i = 0, len = job.target.length; i < len; i = i + 1) {
      if (job.target[i].address) {
        jobs = jobs + 1;
      }
    }
    // now process them...
    for (i = 0, len = job.target.length; i < len; i = i + 1) {
      if (job.target[i].address) {
        runJob(job.target[i].address, job.object);
      }
    }

    if (jobs === completed) {
      q.resolve();
    }
  }

  return q.promise;
};

Feeds.prototype.cleanup = function () {
  var q = Q.defer();
  this.abort = true;
  q.resolve();
  return q.promise;
};

module.exports = function () {
  return new Feeds();
};
