/**
 * @fileOverview A platform-specific primitive set for the module action.js. This is targeted at the js-test-driver,
 * which uses the browser.
 */

/**
 * @namespace
 */
Action_Platform = {};

Action_Platform.dispatch = function( f )
{
  return setTimeout( f, 0 );
};

Action_Platform.set_timer = function( f, duration )
{
  return setTimeout( f, duration )
};

Action_Platform.clear_timer = function( id )
{
  clearTimeout( id );
};

/**
 * The file "action.js" is targeted for the ABP bootstrapped extension environment. We need an implementation of
 * require() to make it work.
 *
 * @param module_name
 * @return {{Action_Platform: *}}
 */
function require( module_name )
{
  switch ( module_name )
  {
    case "action_platform":
      return { Action_Platform: Action_Platform };
    default:
      throw new Error( "Module name not recognized." );
  }
}
