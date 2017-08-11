/*
 * Internet Open Protocol Abstraction (IOPA)
 * Copyright (c) 2017 Internet of Protocols Alliance 
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

 const constants = {
    SERVER: {
        Id: "server.Id",
        Capabilities: "server.Capabilities",
        IsBuilt: "server.IsBuilt",
        Pipeline: "server.Pipeline",
        Logger: "server.Logger",
        Factory: "server.Factory",
        CancelToken: "server.CancelToken",
        CancelTokenSource: "server.CancelTokenSource",
        AppId: "server.AppId",
        IsChild: "server.IsChild",
        ParentContext: "server.ParentContext",
        RawStream: "server.RawStream",
        RawTransport: "server.RawTransport",
        IsLocalOrigin: "server.IsLocalOrigin",
        IsRequest: "server.IsRequest"
    }
}

const util = require('util'),
    SERVER = constants.SERVER;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/***
* Slim Self-Contained AppBuilder Class with no dependencies outside this single file
* AppBuulderServer has two additional features for creating Servers
*   - useServer(scheme, fn) hooks connect methods
*   - use hooks send in addition to invoke
*
* Use Case; Compile/Build all Middleware in a Pipeline into single IOPA AppFunc
*
* @class AppBuilderServer
* @public
*/
function AppBuilderForServers() {
    _classCallCheck(this, AppBuilderForServers);
    AppBuilder.call(this);
}

util.inherits(AppBuilderForServers, AppBuilder);

/**
* Add Middleware Function to AppBuilder pipeline
*
* @param mw the middleware to add 
* @override
*/
AppBuilderForServers.prototype.use = function (scheme, mw) {

    if (typeof scheme !== 'string' && !(scheme instanceof String)) {
        mw = scheme;
        scheme = null;
    }

    var mw_instance = Object.create(mw.prototype);
    mw.call(mw_instance, this);

    if (scheme) {
        this.scheme = scheme;
        this.createServer = createServer_forServers.bind(mw_instance, scheme, this.createServer || function () { throw new Error("no registered transport provider"); });
    } else if (mw_instance.createServer) {

        if (!this.scheme)
            throw new Error("IOPA AppBuilder: createServer function found in middleware, but no server scheme registered with app.use(scheme, fn) ");

        this.createServer = mw_instance.createServer.bind(mw_instance, this.scheme, this.createServer || function () { throw new Error("no registered transport provider"); });

    } else if (mw_instance.send) {

        if (!this.scheme)
            throw new Error("IOPA AppBuilder: send function found in middleware, but no server scheme registered with app.use(scheme, fn) ");

        this.createServer = createServer_forMiddleware.bind(mw_instance, this.scheme, this.createServer || function () { throw new Error("no registered transport provider"); });

    }

    if (mw_instance.invoke)
        this.middleware.push(mw_instance.invoke.bind(mw_instance));

    return this;
}


/***
* Slim Self-Contained AppBuilder Class with no dependencies outside this single file
*
* Use Case; Compile/Build all Middleware in a Pipeline into single IOPA AppFunc
*
* @class AppBuilder
* @public
*/
function AppBuilder() {
    _classCallCheck(this, AppBuilder);
    this.properties = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

    if (typeof this.properties == 'string' || this.properties instanceof String)
        this.properties = { [SERVER.AppId]: this.properties };

    var defaults = {};
    // defaults[SERVER.AppId] = guidFactory();
    defaults[SERVER.Capabilities] = {}
    defaults[SERVER.Logger] = console;

    merge(this.properties, defaults);

    this.middleware = [];
}


Object.defineProperty(AppBuilder.prototype, "log", {
    get: function () {
        return this.properties[SERVER.Logger];
    }
});

AppBuilder.prototype.createContext = function () {

    var context = {};
    var app = this;

    Object.defineProperty(context, "log", {
        get: function () {
            return app.properties[SERVER.Logger];
        }
    });

    return context;

};

/**
* Add Middleware Function to AppBuilder pipeline
*
* @param mw the middleware to add 
*/
AppBuilder.prototype.use = function use(mw) {

    var mw_instance = Object.create(mw.prototype);
    mw.call(mw_instance, this);

    if (mw_instance.invoke)
        this.middleware.push(mw_instance.invoke.bind(mw_instance));

    return this;
}


/**
* Compile/Build all Middleware in the Pipeline into single IOPA AppFunc
*
* @return {function(context): {Promise} IOPA application 
* @public
*/
AppBuilder.prototype.build = function build() {

    this.scheme = undefined;

    var middleware = [DefaultMiddleware].concat(this.middleware).concat([DefaultApp]);

    var pipeline = this.compose_(middleware);
    this.properties[SERVER.Pipeline] = pipeline;
    return pipeline;
}

/**
* Call App Invoke Pipeline to process given context
*
* @return {Promise} Promise that fulfills when pipeline is complete
* @public
*/
AppBuilder.prototype.invoke = function invoke(context) {
    return this.properties[SERVER.Pipeline].call(this, context);
}

/**
* Compile/Build all Middleware in the Pipeline into single IOPA AppFunc
*
* @return {function(context): {Promise} IOPA application 
* @public
*/
AppBuilder.prototype.compose_ = function compose_(middleware) {
    var app = this;

    var i, next, curr;
    i = middleware.length;
    next = function (context) { return Promise.resolve(context); };
    nextinvoke = function (context) { return Promise.resolve(context); };

    while (i--) {
        curr = middleware[i];
        next = (function (fn, prev, context) {
            var _next = prev.bind(app, context);
            _next.invoke = prev;
            return fn.call(app, context, _next)
        }.bind(app, curr, next));
    }

    return function app_pipeline(context) {
        const capabilities = app.properties[SERVER.Capabilities];

        context[SERVER.Capabilities] = context[SERVER.Capabilities] || {};
        merge(context[SERVER.Capabilities], clone(capabilities));

        if (context.response) {
            context.response[SERVER.Capabilities] = context.response[SERVER.Capabilities] || {};
            merge(context.response[SERVER.Capabilities], clone(capabilities));
        }

        return next.call(app, context);
    };
}


// DEFAULT HANDLERS:  RESPOND, DEFAULT APP, ERROR HELPER

function DefaultMiddleware(context, next) {
    var value = next();

    if (typeof value == 'undefined') {
        context.log.error("Server Error: One of the middleware functions returned no value");
    }
    else
        return value;
}

function DefaultApp(context, next) {
    if (context["iopa.Error"])
        return Promise.reject(context["iopa.Error"]);
    else
        return Promise.resolve(context);
}

// FUNCTIONS ADDED TO MIDDLEWARE AND SERVERS

/**
 * @method createServer_forServers
 * Create server object with listen and close methods
 *
 * @param {Object} Options dictionary that includes port num, address string
 * @returns {Promise} 
 * @public
 */
function createServer_forServers(registeredScheme, next, scheme, options) {
    if (scheme !== registeredScheme)
        return next(scheme, options);

    options = options || {};

    if (!this._app.properties[SERVER.IsBuilt])
        this._app.build();

    var server = new IopaServer;

    server.scheme = scheme;
    if (this.connect) server.connect = this.connect.bind(this, server);
    if (this.listen) server.listen = this.listen.bind(this, server);
    if (this.close) server.close = this.close.bind(this, server);
    if (this.send) server.send = this.send.bind(this, server, null);

    return server;
};

/**
 * @method createServer_forMiddleware
 * Create server object with listen and close methods
 *
 * @param {Object} Options dictionary that includes port num, address string
 * @returns {Promise} 
 * @public
 */
function createServer_forMiddleware(registeredScheme, next, scheme, options) {
    if (scheme !== registeredScheme)
        return next(scheme, options);

    var server = next(scheme, options);

    var nextSend = server.send;
    server.send = this.send.bind(this, server, nextSend.bind(server));

    return server;
};

// UTILITY FUNCTIONS

function merge(target, defaults, replace) {
    if (!target)
        throw new Error("target must not be empty");

    if (!defaults)
        defaults = {};

    if (replace) {
        for (var key in defaults) {
            if (defaults.hasOwnProperty(key)) target[key] = defaults[key];
        }
    }
    else {
        for (var key in defaults) {
            if (defaults.hasOwnProperty(key) && !(target.hasOwnProperty(key))) target[key] = defaults[key];
        }
    }
};

/*
 * Clone (Double Layer)
 * 
 * @method clone
 * @param source  object to clone
 * @private
 */
function clone(source) {
    var clone = {};

    for (var key1 in source) {
        if (source.hasOwnProperty(key1)) {
            var item = source[key1];
            if (typeof item == "object") {
                var targetItem = {};

                for (var key2 in item) {
                    if (item.hasOwnProperty(key2)) targetItem[key2] = item[key2];
                }
                clone[key1] = targetItem;
            } else
                clone[key1] = item;
        }
    }

    return clone;
};

function IopaServer() {
     _classCallCheck(this, IopaServer);
};

module.exports =
    {
        App: AppBuilderForServers,
        IopaServer: IopaServer,
        constants: constants
    }
