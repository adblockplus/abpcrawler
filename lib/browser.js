let {Logger} = require( "logger" );

//-------------------------------------------------------
// Tabbed_Browser
//-------------------------------------------------------
/**
 * A single OS-level window of a multiple-tab Firefox browser. This is the object referred to by the global 'gBrowser'.
 *
 * @param {Window} window
 * @param {Number} max_requests
 *      The maximum number of simultaneous requests this object may have.
 * @constructor
 */
var Tabbed_Browser = function( window, max_requests )
{
    /**
     * Browser window through which we access the global browser object.
     * @type {Window}
     */
    this.window = window;

    /**
     * A browser object that can hold multiple individual tabbed browser panes.
     */
    this.tabbed_browser = this.window.gBrowser;

    /**
     * The current number of pending requests in child tabs of this object.
     * @type {Number}
     */
    this.n_requests = 0;

    /**
     * The maximum number of simultaneous requests this object may have.
     * @type {Number}
     */
    this.max_requests = max_requests;

    /**
     * The heart of the dispatcher for both handling progress events and tracking block activity is this map from
     * browser objects to Browser_Tab ones.
     * @type {Map}
     */
    this.map_browser_to_child = new Map();

    /**
     * Every object in the range of the WeakMap has this object as its prototype. This enables map values to have
     * sane defaults.
     *
     * @type {Object}
     */
    //this.map_range_prototype = { browser: null };

    /**
     * A transient set for allocated requests that have not started their load cycle.
     * @type {Set}
     */
    this.allocated_not_loaded = new Set();

    this.listener = { onStateChange: this._progress.bind( this ) };
    this.tabbed_browser.addTabsProgressListener( this.listener );

    this.logger = new Logger( "Tabbed_Browser" );
};

/**
 * Release resources held by this object. This includes event handlers. We also close all the child tabs, since they
 * won't work right after our progress event handler is no longer registered.
 */
Tabbed_Browser.prototype.close = function()
{
    var log = this.logger.make_log( "close" );
    log( "Tabbed_Browser.close" );
    if ( this.listener )
    {
        this.tabbed_browser.removeTabsProgressListener( this.listener );
        this.listener = null;
    }

    let pair = null;
    for ( pair of this.map_browser_to_child )
    {
        let [ key, value ] = pair;
        value.child.close();
        this.map_browser_to_child.delete( key );
    }
};

/**
 * Predicate "is there an open request slot?"
 */
Tabbed_Browser.prototype.available = function()
{
    return this.n_requests < this.max_requests;
};

/**
 * @param {Boolean} [leave_open=false]
 *      Leave the tab open in the browser after closing the present object
 */
Tabbed_Browser.prototype.make_tab = function( leave_open )
{
    return new Browser_Tab( this, leave_open );
};

/**
 * Request an allocation of available HTTP requests. Allocates one if available.
 * <p/>
 * HAZARD: This request is made when the asynchronous action is created, which is strictly before it is launched. If
 * the caller does not either launch the action or close it, there will be a resource leak here.
 *
 * @param child
 * @return {Boolean}
 */
Tabbed_Browser.prototype.request_load = function( child )
{
    if ( !this.available() )
    {
        return false;
    }
    ++this.n_requests;
    this.allocated_not_loaded.add( child );
    return true;
};

/**
 * Notification that a child tab is loading a page. This constitutes a change in the number of unallocated requests.
 *
 * @param {Browser_Tab} child
 */
Tabbed_Browser.prototype.notify_load_begin = function( child )
{
    if ( this.allocated_not_loaded.has( child ) )
    {
        this.allocated_not_loaded.delete( child );
    }
    else
    {
        Cu.reportError( "notice_load_begin: child not found" );
        throw "notice_load_begin: child not found";
    }
    let value = { child: child };
    //value.prototype = this.map_range_prototype;
    this.map_browser_to_child.set( child.browser, value );
};

/**
 * Notification that a child tab is loading a page. This constitutes a change in the number of unallocated requests.
 *
 * @param {Browser_Tab} child
 */
Tabbed_Browser.prototype.notify_load_end = function( child )
{
    if ( this.map_browser_to_child.has( child.browser ) )
    {
        this.map_browser_to_child.delete( child.browser );
    }
    else
    {
        // If we're getting notice of a load ending, it really should be in our map
        Cu.reportError( "Child browser not found in map during 'notice_load_end()'" );
    }
    if ( this.n_requests <= 0 )
    {
        throw "Tabbed_Browser.notify_load_end: n_requests <= 0";
    }
    --this.n_requests;
};

//noinspection JSUnusedLocalSymbols
/**
 * Progress event handler. It looks only for STOP states on the present tab. When that happens, it determines the
 * success status and calls the landing function.
 *
 * @param {*} browser
 * @param {nsIWebProgress} controller
 *      The control object for progress monitoring that dispatches the event.
 * @param {nsIRequest} browse_request
 *      The request object generated by the called to addTab(), which loads a page.
 * @param state
 *      The progress state, represented as flags.
 * @param stop_status
 *      Status code for success or failure if the argument state is a STOP state.
 */
Tabbed_Browser.prototype._progress = function( browser, controller, browse_request, state, stop_status )
{
    /*
     * We only care about STOP states. We're not tracking redirects, which is one of the progress states possible.
     * We may want to in the future, though, in case redirect behavior is involved with ad delivery in some way.
     *
     * As a point of warning, traces on these messages shows that the START message is delivered to the present
     * function _before_ 'notify_load_begin' is called, which seems to mean that the JS interpreter is doing something
     * fishy, either using a second thread or dispatching during a function invocation or return. Regardless, this
     * event come in before it's possible that 'map_browser_to_child' has the 'browser' element of a new tab as a key.
     * Thus, a warning that trapping any other progress state here should happen only after thoroughly tracing the
     * event sequence to determine the actual behavior.
     */
    //noinspection JSBitwiseOperatorUsage
    if ( !(state & Ci.nsIWebProgressListener.STATE_STOP) )
        return;

    /*
     * This handler receives events for all the tabs present in a tabbrowser element, even ones that we didn't
     * add ourselves. It's not an error to receive such events.
     */
    if ( !this.map_browser_to_child.has( browser ) )
    {
        return;
    }

    var {child} = this.map_browser_to_child.get( browser );
    child._new_progress( browser, controller, browse_request, state, stop_status );

    var log = this.logger.make_log( "_progress" );
    var s = "";
    s += "request name = " + browse_request.name + "\n";
    var t = "state";
    if ( state & 0x01 )
    {
        s += "stack = " + Components.stack.toString() + "\n";
        t += " STATE_START";
    }
    if ( state & 0x02 )
    {
        t += " STATE_REDIRECTING";
    }
    if ( state & 0x04 )
    {
        t += " STATE_TRANSFERRING";
    }
    if ( state & 0x10 )
    {
        t += " STATE_STOP";
    }
    if ( state & 0x010000 )
    {
        t += " STATE_IS_REQUEST";
    }
    if ( state & 0x020000 )
    {
        t += " STATE_IS_DOCUMENT";
    }
    if ( state & 0x040000 )
    {
        t += " STATE_IS_NETWORK";
    }
    if ( state & 0x040000 )
    {
        t += " STATE_IS_WINDOW";
    }
    s += t + "\n";
    log( s );
};

//-------------------------------------------------------
// Browser_Tab
//-------------------------------------------------------
/**
 * A single browser tab that can asynchronously load a web page.
 *
 * @param {Tabbed_Browser} parent
 * @param {Boolean} [leave_open=false]
 *      Leave the tab open in the browser after closing the present object
 * @constructor
 */
var Browser_Tab = function( parent, leave_open )
{
    /**
     * The parent tabbed browser in whose tab set this tab is a member.
     * @type {Tabbed_Browser}
     */
    this.parent = parent;

    /**
     * Leave the tab open in the browser after the crawler exits. The reason to do this is to allow manual inspection
     * of the window as the crawler loaded it.
     * <p/>
     * It's necessary to call 'close()' on any instance of this object in order to ensure event handlers are released.
     * This is true whether or not the tab remains open afterwards.
     *
     * @type {Boolean}
     */
    this.leave_open = (arguments.length >= 2) ? leave_open : false;

    /**
     * A browser object that can hold multiple individual tabbed browser panes.
     */
    this.tabbed_browser = this.parent.tabbed_browser;

    /**
     * Our tab within the tabbed browser. This is the "external" view of browser pane, the one that allows us to
     * control loading. The tab must have a URL associated with it, so it's not displayed at the outset
     * <p/>
     * FUTURE: Might it be useful to load the tab with a empty page but descriptive title at construction time?
     */
    this.tab = null;

    /**
     * The function to be run upon completion of an asynchronous load.
     * @type {Function}
     */
    this.finally_f = null;

    /**
     * The function to be run if there's an exceptional termination to an asynchronous load.
     * @type {Function}
     */
    this.catch_f = null;

    /**
     *
     * @type {*}
     */
    this.browser = null;

    /**
     * STATE
     */
    this.state = Browser_Tab.STATE.CREATED;
};

Browser_Tab.STATE = {
    // Initial state
    CREATED: 0,
    // Nonterminal states
    LOADING: 1,
    // Terminal states
    DISPLAYED: 2,
    ERROR: 3,
    CLOSED: 4
};

/**
 * Predicate "is the Browser_Tab in an initial state for its page load?"
 *
 * @return {Boolean}
 */
Browser_Tab.prototype.in_initial_state = function()
{
    return this.state == Browser_Tab.STATE.CREATED;
};

/**
 * Predicate "is this object in a final state for its page load?"
 * <p/>
 * The CLOSED state is considered a final state, although it's present to implement the moral equivalent of a
 * destructor correctly.
 *
 * @return {Boolean}
 */
Browser_Tab.prototype.in_final_state = function()
{
    return this.state >= Browser_Tab.STATE.DISPLAYED;
};

/**
 * Close function destroys our allocated host resources, such as tabs, listeners, requests, etc.
 */
Browser_Tab.prototype.close = function()
{
    if ( this.state == Browser_Tab.STATE.CLOSED )
        return;

    if ( this.tab )
    {
        if ( !this.leave_open )
        {
            this.tabbed_browser.removeTab( this.tab );
        }
        this.tab = null;
    }
    /*
     * FUTURE: Cancel any pending page load here.
     */
    this.state = Browser_Tab.STATE.CLOSED;
};

/**
 * Return an asynchronous action that loads a target into a new tab.
 */
Browser_Tab.prototype.load = function( target )
{
    if ( !this.parent.request_load( this ) )
    {
        // Should not reach. The caller should be calling available() on the Tabbed_Browser first.
        return null;
    }
    return {
        go: function( finally_f, catch_f )
        {
            this.finally_f = finally_f;
            this.catch_f = catch_f;
            this._show( target );
        }.bind( this )
    };
};

/**
 * Show the tab by loading a URL target into it.
 *
 * @param {String} target
 */
Browser_Tab.prototype._show = function( target )
{
    if ( !this.in_initial_state() )
        return;
    try
    {
        this.tab = this.tabbed_browser.addTab( target );
        this.browser = this.tabbed_browser.getBrowserForTab( this.tab );
        this.parent.notify_load_begin( this );
    }
    catch ( e )
    {
        this.state = Browser_Tab.STATE.ERROR;
        Cu.reportError( "Unexpected exception in Browser_Tab.show(): " + e.toString() );
        if ( this.catch_f ) this.catch_f( e );
        if ( this.finally_f ) this.finally_f( false );
    }
};

/**
 * Progress event handler. It looks only for STOP states on the present tab. When that happens, it determines the
 * success status and calls the landing function.
 *
 * @param {*} browser
 * @param {nsIWebProgress} controller
 *      The control object for progress monitoring that dispatches the event.
 * @param {nsIRequest} browse_request
 *      The request object generated by the called to addTab(), which loads a page.
 * @param state
 *      The progress state, represented as flags.
 * @param stop_status
 *      Status code for success or failure if the argument state is a STOP state.
 */
Browser_Tab.prototype._new_progress = function( browser, controller, browse_request, state, stop_status )
{
    /*
     * This check ensures that we only call 'finally_f' once. The browser will send multiple STOP events when the user
     * focuses on a tab window by clicking on its tab. Since we set a final state if we accept the event below, checking
     * for a final state ensures that we act idempotently.
     *
     * This check also forestalls a race condition where a request completes and schedules a progress event while we are
     * closing the object.
     */
    if ( this.in_final_state() )
        return;

    var success = (stop_status == 0 );
    if ( success )
    {
        this.state = Browser_Tab.STATE.DISPLAYED;
    }
    else
    {
        this.state = Browser_Tab.STATE.ERROR;
        /**
         * This argument is an XPCOM 'nsresult' value. It could be examined if the cause of the failure to load needs
         * to be diagnosed. For example, NS_ERROR_OFFLINE would be useful for suspending operation of the crawler while
         * internet connectivity comes back. NS_ERROR_MALFORMED_URI would be useful for notifing the user of a typo.
         */
        this.error_code = stop_status;
    }
    this.parent.notify_load_end( this );
    if ( this.finally_f ) this.finally_f( success, this.error_code );
};

exports.Tabbed_Browser = Tabbed_Browser;
exports.Browser_Tab = Browser_Tab;
