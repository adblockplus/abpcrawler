/**
 * @fileOverview A platform-specific primitive set for the module async.js.
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
