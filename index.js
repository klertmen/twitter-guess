var express = require('express');
var _ = require('lodash');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var app = express();
var redisClient = require('redis').createClient(process.env.REDIS_URL);
var twitterAPI = require('node-twitter-api');
var twitter = new twitterAPI({
	consumerKey: process.env.CONSUMER_KEY,
	consumerSecret: process.env.CONSUMER_SECRET,
	callback: 'https://twitter-guess.herokuapp.com/game'
  });

app.set('port', (process.env.PORT || 5000));

app.use(cookieParser());
app.use(session({secret: '918209381230lajksdf',
		 saveUninitialized: true,
		 resave: true}));

app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.get('/', function(request, response) {
  response.render('pages/index');
});

function populateRedisWithTweets(requestToken, tweets) {
  var tweetsArr = [requestToken+'tweets'];
  tweetsArr.push(_.map(tweets, "id"));
  redisClient.rpush(_.flatten(tweetsArr));
  // add hashes for each tweet
  _.map(tweets, function(tweet) { 
    redisClient.hmset(tweet.id, {
      text: tweet.text,
      userId: tweet.user.id
    });
  });
}

function renderPage(users, response) {
  return function(err, data) {
    console.log(data);
    var tweet = { text: 'New tweet', userId: '123456' }
    return response.render('pages/twitter', { users: users, tweet: tweet.text, tweetId: tweet.userId });
  }
}

function getTweetFromRedis(requestToken, callbackFn, usersList, response) {
  //redisClient.lrange(requestToken+'tweets', 0, 0, callbackFn(usersList, response));
}

app.get('/testEJS', function(request, response) {
  redisClient.set(123456, 5555);
  response.render('pages/twitter', { profileurls: ['https://pbs.twimg.com/profile_images/674634141866983424/-9Ob7KPW_bigger.png', '', '', '', '', ''],
				     tweet: 'This is a tweet',
				     tweetId: 123456,
				     users: [{name: 'Bob', id: 12345, profile_image_url_https: 'https://www.google.com'},
				     	     {name: 'Steve', id: 2222, profile_image_url_https: 'https://www.google.com'},
				     	     {name: 'Nick', id: 4444, profile_image_url_https: 'https://www.google.com'},
				     	     {name: 'Brad', id: 5555, profile_image_url_https: 'https://www.google.com'},
				     	     {name: 'Tom', id: 77777, profile_image_url_https: 'https://www.google.com'},
				     	     {name: 'Ken', id: 88888, profile_image_url_https: 'https://www.google.com'}]
				   });
});

function getSubsetUsers(userId, users) {
	var subsetUsers = _.sample(users, 5);
	if (!_.find(subsetUsers, 'id', userId)) {
		subsetUsers.push(_.find(users, 'id', userId));
	} else {
		while (subsetUsers.length != 6) {
			subsetUsers.push(_.sample(users, 1));
		}
	}
	subsetUsers = _.shuffle(subsetUsers);
	return subsetUsers;
}

app.get('/game', function(request, response) {
  var requestToken = request.session.token;
  var requestTokenSecret = request.session.tokenSecret;
  var oauth_verifier = request.query.oauth_verifier;
  if (!oauth_verifier) {
    getTweetFromRedis(requestToken, renderPage, request.session.users, response);
    return;
  }
  twitter.getAccessToken(requestToken, requestTokenSecret, oauth_verifier, 
	function(error, accessToken, accessTokenSecret, results) {
	  if (error) {
		console.log(error);
	  } else {
		twitter.getTimeline('home', { count : 3 }, accessToken, accessTokenSecret,
		    function(error, data, twitterResp) {
	  		if (error) { 
			  console.log(error); 
			} else { 
			  var randomTweet = _.sample(data);
			  var users = _.uniq(_.map(data, 'user'), "id");
			  request.session.users = users;
			  redisClient.set(randomTweet.id, randomTweet.user.id);
			  populateRedisWithTweets(requestToken, data);
			  var subsetUsers = getSubsetUsers(randomTweet.user.id, users); 
			  response.render('pages/twitter', { users: subsetUsers, tweet: randomTweet.text, tweetId: randomTweet.id });
			}
  		});
	  }
  });
});

app.get('/checkAnswer', function(request, response) {
   var tweetId = request.query.tweetid;
   var choice = request.query.userid;
   redisClient.get(tweetId, function(err, reply) {
      if (reply) {
        var tweetAuthor = reply.toString();
        if (choice === tweetAuthor) {
          response.json({ answer: "correct"});
        } else {
          response.json({ answer: "incorrect", userid: tweetAuthor });
        }
      } else {
        response.send({ answer: "not found" });
      }
   });
});

app.get('/twitter', function(request, response) {
  twitter.getRequestToken(function(error, requestToken, requestTokenSecret, results){
	if (error) {
		console.log(error);
	} else {
		request.session.token = requestToken;
		request.session.tokenSecret = requestTokenSecret;
		response.redirect(twitter.getAuthUrl(requestToken));
	}
  });
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
