'use strict';

const request = require('request-promise-any');
const cheerio = require('cheerio');
const ProxyAgent = require('proxy-agent');
const _ = require('lodash');
const EventEmitter = require('eventemitter3');

/**
 * The default user agent that will be used with all XHR requests.
 * Is a mobile user agent to ensure Tumblr sends a mobile-formatted page.
 * 
 * @constant
 * @type {string}
 * @default 
 */
const TUMBLR_MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";

/**
 * The default user agent that will be used with non-XHR requests.
 * 
 * @constant
 * @type {string}
 * @default 
 */
const TUMBLR_USER_AGENT =  "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";

/**
 * The default login form that will be POSTed.
 * 
 * @constant
 * @type {object}
 * @default
 */
const TUMBLR_LOGIN_FORM = Object.freeze({
	determine_email: null,
	'user[email]': null,
	'user[password]': null,
	'tumblelog[name]': "",
	'user[age]': "",
	context: "home_signup",
	version: "STANDARD",
	follow: "",
	http_referer: "https://www.tumblr.com/",
	seen_suggestion: "0",
	used_suggestion: "0", 
	used_auto_suggestion: "0",
	about_tumblr_slide: "",
	random_username_suggestions: '[""]',
});

/**
 * Transforms an http response into a cheerio object (`$`).
 * 
 * @param {string} body - Body of the response.
 * @returns {any} - Cheerio object.
 * @private
 */
function transform_cheerio (body) { return cheerio.load(body); }

/**
 * This class contains methods that can download photos from a Tumblr blog.
 * 
 * @extends {EventEmitter}
 */
class TumblrImageDownloader extends EventEmitter {
	/**
	 * Options that can be passed to the constructor
	 * @typedef TumblrImageDownloaderOptions
	 * 
	 * @property {CookieJar} [cookie_jar] - A {@link https://bit.ly/2Oq89f0|tough-cookie} compatiable cookie jar. The CookieJar object must be created with `looseMode` set to `true`.
	 * @property {string} [user_agent=TUMBLR_USER_AGENT] -  The user-agent that will be used for desktop requests.
	 * @property {string} [mobile_user_agent=TUMBLR_MOBILE_USER_AGENT] -  The user-agent that will be used for mobile requests.
	 * @property {string} [proxy_url] - URL to a proxy (SOCKS,HTTP or Pac) that will be used with each request. Will be passed to {@link https://bit.ly/2Qz8vSj|proxy-agent}
	 */

	 /**
	  * Creates a `TumblrImageDownloader` object.
	  * @param {TumblrImageDownloaderOptions} options - Options that can be passed to the constructor. All are optional.
	  */
	constructor(options) {
		super();

		let { cookie_jar, user_agent, proxy_url, mobile_user_agent } = options;

		/**
		 * The request `jar` object that will be used with each request.
		 * Is a wrapper for {@link TumblrImageDownloader#cookies} so that `TumblrImageDownloader.cookies == TumblrImageDownloader.jar._jar`.
		 * @type {RequestJar}
		 * @public
		 */
		this.jar = request.jar(cookie_jar);

		/**
		 * The agent that will be used with each request.
		 * @public
		 */
		this.agent = proxy_url ? new ProxyAgent(proxy_url) : void(0);
	
		/**
		 * The user-agent that will be used with each desktop request.
		 * @public
		 * @type {string}
		 * @default TUMBLR_USER_AGENT;
		 */
		this.user_agent = user_agent || TUMBLR_USER_AGENT;

		/**
		 * The user-agent that will be used with XHR requests.
		 * @public
		 * @type {string}
		 * @default TUMBLR_MOBILE_USER_AGENT;
		 */
		this.mobile_user_agent = mobile_user_agent || TUMBLR_MOBILE_USER_AGENT;

		/**
		 * The headers that will be sent with all non-xhr requests.
		 * @public
		 * @type {Object}
		 */
		this.headers = {
			'User-Agent': this.user_agent
		};

		/**
		 * {@link https://bit.ly/2guFWYe|request-promise-any} object that will be used for each request.
		 * @public
		 * @type {Object}
		 */
		this.request = request.defaults({
			jar: this.jar,
			agent: this.agent,
			headers: this.headers
		});

		/**
		 * The login form that will be posted when {@link TumblrImageDownloader#login} is called, excluding the credentials and CSRF.
		 * @public
		 * @type {Object}
		 */
		this.login_form_template = _.cloneDeep(TUMBLR_LOGIN_FORM);
	}

    /**
     * The cookies that will be sent with each request.
     * 
	 * @param {CookieJar} value- A {@link https://bit.ly/2Oq89f0|tough-cookie} compatible `CookieJar` object.
     * @returns {CookieJar} - A {@link https://bit.ly/2Oq89f0|tough-cookie} compatible `CookieJar` object.
     */
	get cookies() {
		return this.jar._jar;
	}
    
	set cookies(value) {
		this.jar._jar = value;
	}

    /**
     * Returns the headers that will be used during XHR requests.
     * 
     * @returns {Object} - Object containing headers
     * @private
     */
	get xhr_headers() {
		return _.extend(_.clone(this.headers), {
			'User-Agent': this.mobile_user_agent,
			'X-Requested-With': 'XMLHttpRequest'
		});
	}

    /**
     * Retrieves the login form from the Tumblr login page and extracts the CSRF token. 
     * Returns the {@link TumblrImageDownloader#login_form_template} object with the CSRF token set to `form_key`.
     * 
     * @returns {Promise<Object>} - The Tumblr login form.
     * @async
     */
	async getLoginForm() {
		let $ = await this.request({
			url: `https://www.tumblr.com/login`,
			transform: transform_cheerio
		});

		let form_key = $('meta[name="tumblr-form-key"]').attr('content');
		
		let form = _.cloneDeep(this.login_form_template);
		form.form_key = form_key;

		return form;
	}

    /**
     * Posts the login form.
     * 
     * @param {Object} - The Tumblr login form.
     * @async
     */
	async postLoginForm(form) {
		let $ = await this.request({
			url: 'https://www.tumblr.com/login',
			form,
			method: 'POST',
			followAllRedirects: true,
			transform: transform_cheerio
		});

		let error_box = $('#signup_forms .error');

		if (error_box.length)
			throw new Error(error_box.text());;
	}

    /**
     * @typedef {Object} TumblrLoginResponse
     * @property {boolean} [already_logged_in] - Indicates if a session already exists for this account.  
     */

    /**
     * Login to the Tumblr account using the provided credentials.
     * 
     * @param {string} - The username to use.
     * @param {string} - The password to use.
     * @returns {Promise<TumblrLoginResponse>}
     * @async
     */
	async login(username, password) {
		let $ = await this.request({
			url: 'https://www.tumblr.com/dashboard',
			followRedirects: true,
			followAllRedirects: true,
			transform: transform_cheerio			
		});
		
		if ($('#signup_forms').length) {
			let form = await this.getLoginForm();
			_.extend(form, {
				determine_email: username,
				'user[email]': username,
				'user[password]': password,								
			});
			
			await this.postLoginForm(form);

			return { already_logged_in: false };
		} else {
			return {
				already_logged_in: true
			};
		}
	}

    /**
     * Downloads an individual photo from a Tumblr blog.
     * @param {string} url - URL of the photo to download.
     * @returns {Promise<ClientResponse>} - HTTP Response.
     * @async
     */
	async downloadPhoto(url) {
		return await this.request({
			url,
			encoding: null,
			resolveWithFullResponse: true
		});
    }
    
    /**
     * Photo in a photoset.
     * 
     * @typedef {Object} PhotosetPhoto
     * @property {string} photo_id - ID of the photo
     * @property {string} photo_url - URL of the photo
     */

     /**
      * Returns the photos in a photoset.
      * 
      * @param {string} url - URL of the photoset.
      * @returns {Promise<PhotosetPhoto[]>} - The photos in the photoset.
      * @async
      */
	async getPhotoset(url) {
		let $ = await request({
			url,
			headers: this.xhr_headers,
			transform: transform_cheerio
		});

		return $('a.photoset_photo').get().map((photoset_photo) => {
			let photo_id =  $(photoset_photo).attr('id').split('photoset_link_').pop();
			let photo_url = $('img', photoset_photo).attr('src');

			return { photo_id, photo_url };
		});
    }
    
    /**
     * Represents data on a individual photo.
     * 
     * @typedef {Object} Photo 
     * @property {string} photo_id - Unique ID of the photo.
     * @property {string} photo_url - URL of the photo.
     * @property {string[]} tags - Tags that belong to the photo.
     * @property {string} author - Original author of the photo.
     * @property {Buffer} [photo_bytes] - The actual downloaded photo. 
     */

    /**
     * Retrieves all photos on a page of a blog.
     * @param {string} blogSubdomain - Subdomain of the blog.
     * @param {number} [pageNumber=1] - Page number of the blog.
     * @returns {Promise<Photo[]>}
     * @async
     */
	async getPhotos(blogSubdomain, pageNumber) {
		let page = pageNumber || 1;
		let $ = await this.request({
			url: `https://${blogSubdomain}.tumblr.com/page/${page}`,
			headers: this.xhr_headers,
			transform: transform_cheerio
		});

		let photos = $('article.photo, article.photoset').get();
		
		let process_photos = photos.map((photo) => {
			let photo_id = $(photo).attr('data-post-id');
			let tags = ($('.tag-link', photo).get()).map(function (element) { return $(element).text(); });
			let author = $('.reblog-link', photo).length ? $('.reblog-link', photo).attr('data-blog-card-username') : blogSubdomain;
			if ($(photo).is('article.photoset')) {
				let photoset_url = `https://${blogSubdomain}.tumblr.com`+$('iframe.photoset', photo).attr('src');
				return this.getPhotoset(photoset_url)
						.then((photoset_photos) => {
							return photoset_photos.map((photo) => {
								return _.extend(photo, { tags, author });
							});
						})
			} else {
				let photo_url = $('img', photo).attr('src');
				return Promise.resolve({ photo_id, photo_url, tags, author });
			}
		});

		let result = await Promise.all(process_photos);
		return _.flatten(result);
	}
    
    /**
     * Options that can be used with {@link TumblrImageDownloader#scrapeBlog}.
     * @typedef ScrapeBlogOptions
     * @property {number} [pageNumber] - Page number to start at.
     * @property {string} blogSubdomain - Subdomain of the blog to scrape from.
     * @property {boolean} [downloadPhotos=false] - Download the photos rather than just grabbing the URLs.
     * @property {boolean} [returnPhotos=false] - Returns all of the photos as an array.
     */

    /**
     * Iterates through all pages in a blog.
     * By default photos are emitted via the {@link TumblrImageDownloader#photo} event and not resolved with the Promise.
     * Set `optioons.returnPhotos` to `true` to return photos.
     * 
     * @example
     * let downloader = new TumblrImageDownloader();
     * downlaoder.on('photo', () => { 'do something with photo' });
     * downloader.scrapeBlog({ blogSubdomain: 'blah' });
     * 
     * @param {ScrapeBlogOptions} options - Options that can be used with this method.
     * @returns {Promise|Promise<Photo[]>}
     * @async
     */
	async scrapeBlog(options) {
		if (!options.blogSubdomain)
			throw new Error("Blog subdomain not provided");
		options.pageNumber = options.pageNumber || 1;
		options.index = options.index || 0;
		let { pageNumber, index, blogSubdomain, downloadPhotos, returnPhotos } = options;
		try {
			let photos = await this.getPhotos(blogSubdomain, pageNumber);

			if (downloadPhotos) {
				let process_photos = photos.map((photo_info) => {
					return this.downloadPhoto(photo_info.photo_url)
						.then((photo_resp) => {
							photo_info.photo_bytes = photo_resp.body;
							return photo_info;
						});
				});

				photos = await Promise.all(process_photos);
			}

			photos.forEach((photo) => this.emit('photo', photo));
			if (returnPhotos) {
				options.photos = (options.photos || []).concat(photos);
			}

			if (photos.length) {
				if ((options.stopAtIndex && index >= options.stopAtIndex) || (options.stopAtPage && pageNumber >= options.stopAtPage)) {
					this.emit('end');
					if (returnPhotos)
						return options.photos;
					return;
				}
				options.pageNumber++;
				options.index++;
				this.emit('pageChange', { blogSubdomain, pageNumber, index  })
				return await this.scrapeBlog(options);
			}
			else {
				this.emit('end');
				if (returnPhotos) 
					return options.photos;
			}
		} catch (error) { 
			this.emit('error', error);
			throw error;
		}
	} 
	
}

/**
 * Module that contains the {@link TumblrImageDownloader} class.
 * @module tumblr-image-downloader/TumblrImageDownloader
 * @see TumblrImageDownloader
 */
module.exports = TumblrImageDownloader;