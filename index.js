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

app.get('/game', function(request, response) {
  var requestToken = request.session.token;
  var requestTokenSecret = request.session.tokenSecret;
  var oauth_verifier = request.query.oauth_verifier;
  twitter.getAccessToken(requestToken, requestTokenSecret, oauth_verifier, 
	function(error, accessToken, accessTokenSecret, results) {
	  if (error) {
		console.log(requestToken);
		console.log(error);
	  } else {
		twitter.getTimeline('home', { count : 6 }, accessToken, accessTokenSecret,
		    function(error, data, twitterResp) {
	  		if (error) { 
			  console.log(error); 
			} else { 
			  // TODO: save tweetId/author in Redis, on button click, check against Redis if correct
			  var randomTweet = _.sample(data);
			  var users = _.map(data, 'user');
			  redisClient.set(randomTweet.id, randomTweet.user.id);
			  response.render('pages/twitter', { users: users, tweet: randomTweet.text, tweetId: randomTweet.id });
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
