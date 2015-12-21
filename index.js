var express = require('express');
var _ = require('lodash');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var app = express();
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
  response.render('pages/twitter', { profileurls: ['https://pbs.twimg.com/profile_images/674634141866983424/-9Ob7KPW_bigger.png', '', '', '', '', ''],
				     tweet: 'This is a tweet',
				     usernames: ['Bob', 'Mike', 'Sam', 'Tom', 'Hank', 'Steve'] });
});

app.get('/game', function(request, response) {
  var requestToken = request.session.token;
  var requestTokenSecret = request.session.tokenSecret;
  var oauth_verifier = request.query.oauth_verifier;
  twitter.getAccessToken(requestToken, requestTokenSecret, oauth_verifier, 
	function(error, accessToken, accessTokenSecret, results) {
	  if (error) {
		console.log(error);
	  } else {
		twitter.getTimeline('home', { count : 6 }, accessToken, accessTokenSecret,
		    function(error, data, twitterResp) {
	  		if (error) { 
			  console.log(error); 
			} else { 
			  var tweets = _.pluck(data, 'text'); 
			  var urls = _.map(data, 'user.profile_image_url');
			  var usernames = _.map(data, 'user.name');
			  response.render('pages/twitter', { profileurls: urls, tweet: _.sample(tweets), usernames: usernames});
			}
  		});
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
