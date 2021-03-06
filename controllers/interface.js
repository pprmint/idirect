var config = require(__dirname + '/../config/config'),
    logger = require(__dirname + '/../lib/logger'),
    util = require(__dirname + '/../helpers/util'),
    db = require(__dirname + '/../lib/mongodb'),
    curl = require(__dirname + '/../lib/curl'),
    tropowebapi = require('tropo-webapi'),
    geocoder = require('node-geocoder').getGeocoder('google', 'https', {apiKey:'AIzaSyDKQ3Yg0wQf1oFcHCbdHNdqAQ3PgBFIFIU',formatter:null}),
    globe = require(__dirname + '/../helpers/globe/globeapi')(),
    globe_app_secret = 'c493b9bc145b88d11bc401eb1a0686ff50588d39c58409958f99d540eaf8afda',
    globe_app_id = 'Gd9ons7nBEoC7kTRX9cB8GCdX9z4s6x9',
    globe_voice_id = 287,
    globe_voice_token = '42576f634348496d4b554f55715a445473614e74794b5875755253657a715076707772664c4b647267704347',
    globe_short_code = '21581150';

exports.globe_callback = function (req, res, next) {
    logger.log('info','Globe get callback');
		var data = req.body,
		code = data['code'];

	console.log(req.query);

	var auth = globe.Auth(globe_app_id, globe_app_secret);
	var login_url = auth.getLoginUrl();

	console.log(data);
	if (!code) {
       	res.send(400, {message : 'Login failed'});
        return;
    }



    res.send(200, {message : 'Login failed'});
    return;
	db.get().collection('users', function (err, collection) {
		if (err) return next(err);
		collection.find({_id : data.number, password : data.password}).toArray(function (err, docs) {
			if (err)
				return next(err);
			if (docs.length > 0)
				return res.send(200, {message : 'Login successful'});
			res.send(400, {message : 'Login failed'});
		});
	});
};

exports.globe_get_callback = function(req,res,next) {

    logger.log('info','Globe get Callback');

	var data = req.query;
	console.log(data);

	if (data.subscriber_number) {
		var inst =  {
			_id : data.subscriber_number,
			access_token : data.access_token,
			number : data.subscriber_number,
			strikes : 0
		}
		db.get().collection('mobile_numbers', function (err, collection) {
			if (err) return next(err);
			collection.insert(inst, function (err) {
				if (err) return next(err);
				res.send(200, {message : 'Insert successful'});
			});
		});
	}
	if (data.code) {
		res.send(200, {message : 'Update successful'});
	}

	var sms = globe.SMS(globe_short_code, data.subscriber_number, data.access_token);
	sms.sendMessage("Thank you for registering in ShakeCast! Download the android app to fully use the system in times of danger. ShakeCast allows you to shake your mobile device in times of danger. Once shaken, the application will send distress messages to your relatives and authorities.", function(rq,rs) {
		console.log(rs.body);
	});

};

exports.globe_sms_notify = function (req, res, next) {
    logger.log('info','SMS notify.');
	var data = req.body,
		msg_data = data.inboundSMSMessageList.inboundSMSMessage[0],
		number = msg_data.senderAddress.split(':'),
		parsed,
		user_info,
		location,
		string_loc = '',
		components,
		detail_components,
		page_components,
		part_data = {},
		send_to = function(number, message, from) {
			curl.get
				.to('semaphore.co', 80, '/api/sms')
				.send({
					api : 'qJzKNo15iTsNEYdqrcQA',
					number : number,
					from : from,
					message : message
				})
				.then(function(st, _d) {
					console.log(st);
					console.log(_d);
				})
				.then(next);
		},
		call_someone = function (number, name, location) {
			var tropo = new TropoWebAPI(),
				msg = "Hi! This is a distress call from " + name + ". Please call that person immediately. His last location is "+location;
				// tropo.call("+" + number);
	   //      	tropo.say();
    //     		res.send(TropoJSON(tropo));

    		curl.get
				.to('api.tropo.com', 443, '/1.0/sessions')
				.secured()
				.send({
					action : 'create',
					token : globe_voice_token,
					numToCall : number,
					payload : msg
				})
				.then(function(s,d) {
					console.log(s);
					console.log(d);
				})
				.then(next);

		},
		spread_the_word = function (l) {
			var footer = 'This is an auto generated message. Maaring kontakin agad ang taong nagpadala ng mensahe.'
			if (parsed.s === true) {
                db.get().collection('directories', function (err, collection) {
                    collection.find(
                        {   location :
                            {
                            	$near: [ location.longitude, location.latitude ]
                            }
                        }).toArray(function (err,results) {
                            if(err) return res.send(500,err);
                            console.log(results);
                            if(results.length > 0) {
                            send_to('63'+results[0].data[0].contact_number[0],parsed.d+':'+user_info.number+'\n'+'I need help right now! Please try to contact my phone number or go to my most recent location.'+
                                ' LOCATION: ' + l + 'Lat/Lng:' +
                                location.latitude + '/' + location.longitude +
                                ' \n' + footer, 'ShakeCast');
                         	}
                            else {
                                res.send(400,{message:"No results"});
                            }

                        });
                });


            }
			for(var i in parsed.n) {
				if(i === 0)
					call_someone('63'+parsed.n[i].substring(1),parsed.d,l);

				send_to(parsed.n[i], parsed.d + '\n' + parsed.mt + ' LOCATION:' + l + 'Lat/Lng:' + location.latitude + '/' + location.longitude + ' \n' +  footer, 'ShakeCast');
			}
			return res.send(200);
		},

		found_location = function(status, _data) {
			console.log(_data);

			if (status !== 200 || !_data.terminalLocationList.terminalLocation.currentLocation)
				return next('Failed to get location');
			location = _data.terminalLocationList.terminalLocation.currentLocation;

			db.get().collection('messages', function (err, collection) {
				collection.insert({
					name : parsed.d,
					mobile_number : part_data.sender,
					mobile_contacts : parsed.n,
					email_contacts : parsed.e,
					severity : parsed.s,
					email_message : parsed.me,
					text_message : parsed.mt,
					location : {
							lat : location.latitude,
							lng : location.longitude
						},
					timestamp : location.timestamp
				}, function (err, inst) {
					if (err) return next(err);

				});
			});

			geocoder.reverse(location.latitude, location.longitude, function(err, res) {
    			if (err) return next(err);
    			if(res.length === 0)
    				return spread_the_word('We cant find proper location name.');
    			res[0].streetName 	&& (string_loc += (res[0].streetName + ' '));
    			res[0].city 		&& (string_loc += (res[0].city + ' '));
    			res[0].state 		&& (string_loc += (res[0].state + ' '));
    			res[0].country 		&& (string_loc += res[0].country);
    			spread_the_word(string_loc);
			});

		};
	components = msg_data.message.split(';;');
	detail_components = components[0].split(':');
	page_components = detail_components[1].split('/');


	part_data.batch_stamp = detail_components[0];
	part_data.page = page_components[0];
	part_data.total = page_components[1];
	part_data.message = components[1];
	part_data.sender = number[1].substring(3);

	db.get().collection('parts', function (err, collection) {
		if (err) return next(err);
		collection.insert(part_data, function (err, inst) {
			if (err) return next(err);
			collection.find({batch_stamp:part_data.batch_stamp, sender:part_data.sender}).sort({page:1}).toArray(function (e, _data) {
				var concat_data = '';

				if (e) return next(e);

				if(_data.length == part_data.total) {
					for(var i in _data) {
						concat_data += _data[i].message;
					}
					try {
						parsed = JSON.parse(concat_data);

						db.get().collection('mobile_numbers', function (err, _collection) {
							if (err) return next(err);
							_collection.find({_id: part_data.sender}).toArray(function (err, usr) {
								if (err) return next(err);
								if (usr.length !== 0) {
									user_info = usr[0];
									curl.get
										.to('devapi.globelabs.com.ph', 80, '/location/v1/queries/location')
										.send({
											access_token : user_info.access_token,
											requestedAccuracy : 100,
											address : user_info.number
										})
										.then(found_location)
										.then(next);
								}
							});
						});
					} catch (e) {
						console.log('error');
						console.log(concat_data);
						return;
					}
				}
				return;
			});
		});
	});
	// try {
	// 	components = JSON.parse(msg_data.message);
	// 	db.get().collection('mobile_numbers', function (err, collection) {
 //        	collection.find({_id : number[0].substring(3)}).toArray(find_location);
	// 	});
	// } catch (e) {
	// 	console.log('not json');
	// }

	res.send(200);
	return;
};

exports.globe_sms_notify2 = function (req, res, next) {
	var data = req.body;


	console.log('notify2');
	console.log(req.query);
	console.log(data);

	res.send(200);
	return;
};

exports.try_tropo = function (req, res, next) {
		msg = "Hi! This is a distress call from ninz. Please call that person immediately. His last location is ";
				// tropo.call("+" + number);
	   //      	tropo.say();
    //     		res.send(TropoJSON(tropo));

    		curl.get
				.to('api.tropo.com', 443, '/1.0/sessions')
				.secured()
				.send({
					action : 'create',
					token : globe_voice_token,
					numToCall : '09175247735',
					payload : msg
				})
				.then(function(s,d) {
					console.log(s);
					console.log(d);
				})
				.then(next);

};

exports.globe_send = function (req, res, next) {
	var data = req.body,
		id = data.number;
	delete data.number;
	db.get().collection('users', function (err, collection) {
		if (err) return next(err);
		collection.update({_id : id}, {$set : data}, function (err) {
			if (err) return next(err);
			res.send(200, {message : 'Update successful'});
		});
	});
};
exports.semaphore_send = function (req, res, next) {
	var data = req.body,
		id = data.number;
	delete data.number;
	db.get().collection('users', function (err, collection) {
		if (err) return next(err);
		collection.update({_id : id}, {$set : data}, function (err) {
			if (err) return next(err);
			res.send(200, {message : 'Update successful'});
		});
	});
};
