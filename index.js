var cool = require('cool-ascii-faces');
var express = require('express');
var app = express();
var twitterAPI = require('node-twitter-api')

app.set('port', (process.env.PORT || 5000));

app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.get('/', function(request, response) {
  response.render('pages/index');
});

app.get('/authorized', function(request, response) {
  response.send('token: ' + request.query.oauth_token + ' verifier:' + request.query.oauth_verifier); 
});

app.get('/twitter', function(request, response) {
  var twitter = new twitterAPI({
	consumerKey: 'xaOgQc0Im1PooxmkCJPuoQ',
	consumerSecret: '8R3AzD6IaiJ1UUfPLihtV80T0nJ8vMh1CPDIxDCSU',
	callback: 'https://twitter-guess.herokuapp.com/authorized'
  });
  var token = '';
  var tokenSecret = '';
  twitter.getRequestToken(function(error, requestToken, requestTokenSecret, results){
	if (error) {
		console.log(error);
	} else {
		console.log(requestToken);
		token = requestToken;
		tokenSecret = requestTokenSecret;
		response.redirect(twitter.getAuthUrl(requestToken));
		//store token and tokenSecret somewhere, you'll need them later; redirect user 
	}
  });
  //response.send(cool());
});

app.get('/cool', function(request, response) {
  response.send(cool());
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});


