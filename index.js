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
		 cookie: { maxAge: 31536000000 }, // session expires in one year 
		 resave: true}));

app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

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
    // set TTL for each tweet to 1 day (86400 seconds)
    redisClient.expire(tweet.id, 86400);
  });
}

function renderPage(requestToken, session, response) {
  return function(err, tweetId) {
    // handle case where no more tweets
    if(!tweetId) {
	return getTweetsFromTimeline(session, requestToken, response);
    }
    return redisClient.hgetall(tweetId, function(err, tweet) {
	redisClient.del(tweetId);
   	redisClient.set(tweetId+'answer', tweet.userId);
	var subsetUsers = getSubsetUsers(tweet.userId, session.users);
	var percentCorrect = ((session.numberCorrect / (session.questionCount - 1)) * 100).toFixed();
    	return response.render('pages/twitter', 
		{ currentQuestionNumber: session.questionCount, 
		  users: subsetUsers, tweet: tweet.text, 
		  tweetId: tweetId, percentCorrect: percentCorrect,
		  userName: session.userName 
		 });
    });
  }
}

function getNextTweetFromRedis(requestToken, session, response) {
  redisClient.lpop(requestToken+'tweets', renderPage(requestToken, session, response));
}

function getSubsetUsers(userId, users) {
  var subsetUsers = _.sample(users, 5);
  userId = Number(userId);
  // add correct user to list if it's not part of sample
  if (!_.find(subsetUsers, 'id', userId)) {
    subsetUsers.push(_.find(users, 'id', userId));
  } else {
    // if correct user is in sample, add unique users
    while (subsetUsers.length != 6) {
      var newUser = _.sample(users);
      if (!_.find(subsetUsers, 'id', newUser.id)) {
        subsetUsers.push(newUser);
      }
    }
  }
  subsetUsers = _.shuffle(subsetUsers);
  return subsetUsers;
}

function setTwitterUserName(request, accessToken, accessTokenSecret) {
  twitter.verifyCredentials(accessToken, accessTokenSecret, function(error, data, response) {
    if (error) {
       console.log(error);
    } else {
      request.session.userName = data.name;
      // TODO: store list of user sessions
      redisClient.set(data.screen_name+'+user+'+new Date().toUTCString(), accessToken);
    }
  });
}

function getTweetsFromTimeline(session, requestToken, response) {
  return twitter.getTimeline('home', { count : 200, exclude_replies: true }, session.accessToken, session.accessTokenSecret,
    function(error, data, twitterResp) {
	    if (error) {
	      console.log(error);
	    } else {
 	      // TODO: filter out RTs
	      data = _.shuffle(_.filter(data, function(tweet) { return !tweet.text.match('^RT @'); }));
	      var randomTweet = _.first(data);
	      var users = _.uniq(_.map(data, 'user'), "id");
	      var percentCorrect = 0;
	      session.users = users;
	      if (!session.questionCount) {
	        session.questionCount = 1;
	      }
	      if (!session.winStreak) {
	        session.winStreak = 0;
	      }
	      if (!session.numberCorrect) {
	      	session.numberCorrect = 0;
	      } else {
	      	percentCorrect = ((session.numberCorrect / (session.questionCount - 1)) * 100).toFixed();
	      }
	      redisClient.set(randomTweet.id+'answer', randomTweet.user.id);
	      populateRedisWithTweets(requestToken, _.rest(data));
	      var subsetUsers = getSubsetUsers(randomTweet.user.id, users);
	      response.render('pages/twitter',
		    { currentQuestionNumber: session.questionCount,
		      users: subsetUsers, tweet: randomTweet.text, tweetId: randomTweet.id,
		      percentCorrect: percentCorrect,
		      userName: session.userName 
		    });
	    }
    });
}

function getRequestTokenAndRedirect(request, response) {
  return twitter.getRequestToken(function(error, requestToken, requestTokenSecret, results){
	if (error) {
		console.log(error);
	} else {
		request.session.token = requestToken;
		request.session.tokenSecret = requestTokenSecret;
		response.redirect(twitter.getAuthUrl(requestToken));
	}
  });
}

app.get('/game', function(request, response) {
  var requestToken = request.session.token;
  var requestTokenSecret = request.session.tokenSecret;
  var oauth_verifier = request.query.oauth_verifier;
  if (!request.session.token) {
    return getRequestTokenAndRedirect(request, response);
  }
  // after first question, won't get an oauth_verifier
  if (!oauth_verifier) {
    if (!request.session.numberCorrect) { 
      request.session.numberCorrect = 0;
    } 
    if (!request.session.questionCount) { 
      request.session.questionCount = 1;
    } else {
      request.session.questionCount = request.session.questionCount+1;
    }
    getNextTweetFromRedis(requestToken, request.session, response);
    return;
  }
  twitter.getAccessToken(requestToken, requestTokenSecret, oauth_verifier,
    function(error, accessToken, accessTokenSecret, results) {
	if (error) {
	 console.log(error);
	} else {
	 setTwitterUserName(request, accessToken, accessTokenSecret);
	 request.session.accessToken = accessToken;
	 request.session.accessTokenSecret = accessTokenSecret;
	 getTweetsFromTimeline(request.session, requestToken, response);
      	}
    });
});

app.get('/checkAnswer', function(request, response) {
   var tweetId = request.query.tweetid;
   var choice = request.query.userid;
   redisClient.get(tweetId+'answer', function(err, reply) {
      if (reply) {
        var tweetAuthor = reply.toString();
        if (choice === tweetAuthor) {
	  request.session.numberCorrect = request.session.numberCorrect+1;
 	  if (request.session.winStreak) {
	    request.session.winStreak = request.session.winStreak+1;
          } else {
	    request.session.winStreak = 1;	  
	  }
          response.json({ answer: "correct", winStreak: request.session.winStreak });
        } else {
	  request.session.winStreak = 0;
          response.json({ answer: "incorrect", userid: tweetAuthor });
        }
   	redisClient.del(tweetId+'answer');
      } else {
        response.send({ answer: "not found" });
      }
   });
});

app.get('/resetScores', function(request, response) {
  request.session.questionCount = undefined;
  request.session.numberCorrect = undefined;
  response.send();
});

app.get('/', function(request, response) {
  var requestToken = request.session.token;
  var requestTokenSecret = request.session.tokenSecret;
  if (!request.session.token) {
    return getRequestTokenAndRedirect(request, response);
  } else {
    request.session.questionCount = request.session.questionCount+1;
    getNextTweetFromRedis(requestToken, request.session, response);
    return;
  }
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
