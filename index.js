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

function renderPage(requestToken, session, response) {
  return function(err, tweetId) {
    // TODO: handle case where no more tweets
    if(!tweetId) {
	return getTweetsFromTimeline(session, requestToken, response);
    }
    return redisClient.hgetall(tweetId, function(err, tweet) {
	redisClient.del(tweetId);
   	redisClient.set(tweetId+'answer', tweet.userId);
	var subsetUsers = getSubsetUsers(tweet.userId, session.users);
	var percentCorrect = ((session.numberCorrect / (session.questionCount - 1)) * 100).toFixed();
    	return response.render('pages/twitter', { currentQuestionNumber: session.questionCount, users: subsetUsers, tweet: tweet.text, tweetId: tweetId, percentCorrect: percentCorrect });
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
      //accessToken and accessTokenSecret can now be used to make api-calls (not yet implemented)
      //data contains the user-data described in the official Twitter-API-docs
      //you could e.g. display his screen_name
      request.session.userName = data.name;
    }
  });
}

function getTweetsFromTimeline(session, requestToken, response) {
  return twitter.getTimeline('home', { count : 200 }, session.accessToken, session.accessTokenSecret,
    function(error, data, twitterResp) {
	    if (error) {
	      console.log(error);
	    } else {
	      var randomTweet = _.first(data);
	      var users = _.uniq(_.map(data, 'user'), "id");
	      var percentCorrect = 0;
	      session.users = users;
	      if (!session.questionCount) {
	        session.questionCount = 1;
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
		      percentCorrect: percentCorrect 
		    });
	    }
    });
}

app.get('/game', function(request, response) {
  var requestToken = request.session.token;
  var requestTokenSecret = request.session.tokenSecret;
  var oauth_verifier = request.query.oauth_verifier;
  if (!oauth_verifier) {
    request.session.questionCount = request.session.questionCount+1;
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
          response.json({ answer: "correct"});
        } else {
          response.json({ answer: "incorrect", userid: tweetAuthor });
        }
      } else {
        response.send({ answer: "not found" });
      }
   });
});

app.get('/', function(request, response) {
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
