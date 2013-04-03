let {Logger} = require( "logger" );
let {Action} = require( "action" );

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
  if ( !this.tabbed_browser )
  {
    throw new Error( "Tabbed_Browser: argument 'window' has null member 'gBrowser'" );
  }

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
  log( "Tabbed_Browser.close", false );
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
 * Predicate: "Are there no open tabs?"
 * @return {boolean}
 */
Tabbed_Browser.prototype.quiescent = function()
{
  return this.n_requests == 0;
};

/**
 * @param {string} target
 * @param {Boolean} [leave_open=false]
 *      Leave the tab open in the browser after closing the present object
 */
Tabbed_Browser.prototype.make_tab = function( target, leave_open )
{
  return new Browser_Tab( this, target, leave_open );
};

/**
 * Request an allocation of available HTTP requests. Allocates one if available.
 * <p/>
 * HAZARD: This request is made when the asynchronous action is created, which is strictly before it is launched. If
 * the caller does not either launch the action or close it, there will be an internal resource leak here.
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
  this.map_browser_to_child.set( child.browser, value );
};

/**
 * Notification that a child tab is loading a page. This constitutes a change in the number of unallocated requests.
 * <p/>
 * The child must only call this function once, since it acts as a resource deallocator, freeing up a request slot.
 */
Tabbed_Browser.prototype.notify_load_end = function()
{
  if ( this.n_requests <= 0 )
  {
    throw "Tabbed_Browser.notify_load_end: n_requests <= 0";
  }
  --this.n_requests;
};

/**
 * Notification that a child tab is closing. We leave the tab present in our map of active children until the tab is
 * closed. This allows us to handle events that occur after the document has loaded, which typically arise from
 * scripts on the page.
 *
 * @param child
 */
Tabbed_Browser.prototype.notify_close = function( child )
{
  if ( this.map_browser_to_child.has( child.browser ) )
  {
    this.map_browser_to_child.delete( child.browser );
  }
  else
  {
    // If we're getting this notice, it really should be in our map
    Cu.reportError( "Child browser not found in map during 'notice_close()'" );
  }
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
  child._stop( stop_status );

  var log = this.logger.make_log( "_progress" );
  log( "request name = " + browse_request.name, false );
};

//-------------------------------------------------------
// Browser_Tab
//-------------------------------------------------------
/**
 * A single browser tab that can asynchronously load a web page.
 *
 * @param {Tabbed_Browser} parent
 * @param {string} target
 * @param {Boolean} [leave_open=false]
 *      Leave the tab open in the browser after closing the present object
 * @constructor
 * @extends {Action.Asynchronous_Action}
 */
var Browser_Tab = function( parent, target, leave_open )
{
  Action.Asynchronous_Action.init.call( this );

  /**
   * The parent tabbed browser in whose tab set this tab is a member.
   * @type {Tabbed_Browser}
   */
  this.parent = parent;

  /**
   * The target URL to browse to.
   * @type {string}
   */
  this.target = target;

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
   *
   * @type {*}
   */
  this.browser = null;

  /**
   * STATE
   */
  this.local_state = Browser_Tab.STATE.CREATED;
};
Browser_Tab.prototype = new Action.Asynchronous_Action();

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
  return this.local_state == Browser_Tab.STATE.CREATED;
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
  return this.local_state >= Browser_Tab.STATE.DISPLAYED;
};

/**
 * Close function destroys our allocated host resources, such as tabs, listeners, requests, etc.
 */
Browser_Tab.prototype.close = function()
{
  if ( this.local_state == Browser_Tab.STATE.CLOSED )
    return;

  if ( this.tab )
  {
    this.tab.removeEventListener( "TabClose", this.tab_close_listener );
    this.tab_close_listener = null;
    if ( !this.leave_open )
    {
      this.tabbed_browser.removeTab( this.tab );
    }
    this.tab = null;
    /*
     * Kill the map from our associated browser to this object. This is the point at which we can no longer
     * locate this object with a 'browser' or 'window' object.
     */
    this.parent.notify_close( this );
    this.browser = null;
  }
  /*
   * FUTURE: Cancel any pending page load here.
   */
  this.local_state = Browser_Tab.STATE.CLOSED;
};

/**
 * Show the tab by loading a URL target into it.
 */
Browser_Tab.prototype._go = function()
{
  if ( !this.parent.request_load( this ) )
  {
    // Should not reach. The caller should be calling available() on the Tabbed_Browser first.
    throw new Error( "Browser_Tab: may not launch when no Tabbed_Browser is available." );
  }
  if ( !this.in_initial_state() )
    return;
  try
  {
    this.tab = this.tabbed_browser.addTab( this.target );
    this.browser = this.tabbed_browser.getBrowserForTab( this.tab );
    this.parent.notify_load_begin( this );
    this.tab_close_listener = this._tab_closed.bind( this );
    this.tab.addEventListener( "TabClose", this.tab_close_listener );
  }
  catch ( e )
  {
    this.local_state = Browser_Tab.STATE.ERROR;
    Cu.reportError( "Unexpected exception in Browser_Tab.show(): " + e.toString() );
    this.end_badly( e );
  }
};

/**
 * Stop event handler. It receives only STOP events on the present tab. When that happens, it determines the
 * success status and calls the landing function.
 *
 * Note: This function is also called when the user closes a tab manually.
 *
 * @param stop_status
 *      Status code for success or failure if the argument state is a STOP state.
 */
Browser_Tab.prototype._stop = function( stop_status )
{
  /*
   * This check ensures that we only call the finisher once. The browser will send multiple STOP events when the user
   * focuses on a tab window by clicking on its tab. Since we set a final state below, checking for a final state
   * ensures that we act idempotently.
   *
   * This check also forestalls a race condition where a request completes and schedules a progress event while we are
   * closing the object.
   */
  if ( this.completed )
    return;
  if ( this.in_final_state() )
    return;

  /*
   * This notice back to the parent must happen after the check for being in a final state. Since multiple STOP
   * events may arrive on a tab (they're not all for the original document), we send this notice just once, which
   * means that we need to examine the state in this Browser_Tab instance.
   */
  this.parent.notify_load_end();

  var success = ( stop_status == 0 );
  if ( success )
  {
    this.local_state = Browser_Tab.STATE.DISPLAYED;
  }
  else
  {
    this.local_state = Browser_Tab.STATE.ERROR;
    /**
     * This argument is an XPCOM 'nsresult' value. It could be examined if the cause of the failure to load needs
     * to be diagnosed. For example, NS_ERROR_OFFLINE would be useful for suspending operation of the crawler while
     * internet connectivity comes back. NS_ERROR_MALFORMED_URI would be useful for notifing the user of a typo.
     */
    this.error_code = stop_status;
  }
  this.end_well( [ success, this.error_code ] );
};

/**
 * Event handler when the tab is closed by user gesture. This might or might not interrupt a pending transfer.
 *
 * @private
 */
Browser_Tab.prototype._tab_closed = function()
{
  /*
   * Pretend that the transfer completed successfully. We're going to close ourselves in a moment, and we'll have
   * state DISPLAYED for a moment, but it won't matter, but only because JavaScript is single-threaded.
   */
  this._stop( 0 );
  this.close();
};

exports.Tabbed_Browser = Tabbed_Browser;
exports.Browser_Tab = Browser_Tab;
