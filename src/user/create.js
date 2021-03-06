'use strict';

var async = require('async'),
	db = require('./../database'),
	utils = require('./../../public/src/utils'),
	validator = require('validator'),
	plugins = require('./../plugins'),
	groups = require('./../groups');

module.exports = function(User) {

	User.create = function(userData, callback) {
		userData = userData || {};
		userData.userslug = utils.slugify(userData.username);

		userData.username = userData.username.trim();
		if (userData.email !== undefined) {
			userData.email = userData.email.trim();
			userData.email = validator.escape(userData.email);
		}

		async.parallel([
			function(next) {
				if (userData.email) {
					next(!utils.isEmailValid(userData.email) ? new Error('Invalid Email!') : null);
				} else {
					next();
				}
			},
			function(next) {
				next((!utils.isUserNameValid(userData.username) || !userData.userslug) ? new Error('Invalid Username!') : null);
			},
			function(next) {
				if (userData.password) {
					next(!utils.isPasswordValid(userData.password) ? new Error('Invalid Password!') : null);
				} else {
					next();
				}
			},
			function(next) {
				User.exists(userData.userslug, function(err, exists) {
					if (err) {
						return next(err);
					}
					next(exists ? new Error('Username taken!') : null);
				});
			},
			function(next) {
				if (userData.email) {
					User.email.available(userData.email, function(err, available) {
						if (err) {
							return next(err);
						}
						next(!available ? new Error('Email taken!') : null);
					});
				} else {
					next();
				}
			},
			function(next) {
				plugins.fireHook('filter:user.create', userData, function(err, filteredUserData){
					next(err, utils.merge(userData, filteredUserData));
				});
			}
		], function(err, results) {
			if (err) {
				return callback(err);
			}
			userData = results[results.length - 1];

			db.incrObjectField('global', 'nextUid', function(err, uid) {
				if(err) {
					return callback(err);
				}

				var gravatar = User.createGravatarURLFromEmail(userData.email);
				var timestamp = Date.now();
				var password = userData.password;

				userData = {
					'uid': uid,
					'username': userData.username,
					'userslug': userData.userslug,
					'fullname': '',
					'location': '',
					'birthday': '',
					'website': '',
					'email': userData.email || '',
					'signature': '',
					'joindate': timestamp,
					'picture': gravatar,
					'gravatarpicture': gravatar,
					'uploadedpicture': '',
					'profileviews': 0,
					'reputation': 0,
					'postcount': 0,
					'lastposttime': 0,
					'banned': 0,
					'status': 'online'
				};

				db.setObject('user:' + uid, userData, function(err) {

					if(err) {
						return callback(err);
					}
					db.setObjectField('username:uid', userData.username, uid);
					db.setObjectField('userslug:uid', userData.userslug, uid);

					if (userData.email !== undefined) {
						db.setObjectField('email:uid', userData.email, uid);
						if (parseInt(uid, 10) !== 1) {
							User.email.verify(uid, userData.email);
						}
					}

					plugins.fireHook('action:user.create', userData);
					db.incrObjectField('global', 'userCount');

					db.sortedSetAdd('users:joindate', timestamp, uid);
					db.sortedSetAdd('users:postcount', 0, uid);
					db.sortedSetAdd('users:reputation', 0, uid);

					groups.join('registered-users', uid);

					if (password) {
						User.hashPassword(password, function(err, hash) {
							if(err) {
								return callback(err);
							}

							User.setUserField(uid, 'password', hash);
							callback(null, uid);
						});
					} else {
						callback(null, uid);
					}
				});
			});
		});
	};
};