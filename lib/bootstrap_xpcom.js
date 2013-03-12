/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

//-----------------------------------------------------------------------------------------
// Singleton_class
//-----------------------------------------------------------------------------------------
/**
 *
 * @param {string} class_description
 *    Human-readable description of the class.
 * @param class_ID
 *    Class ID for this component.
 * @param contract_ID
 *    The contract ID that this component uses. It's only a single ID for this relatively-simple class.
 * @param {Array} interfaces
 *    An array of interfaces that this class supports. Used to initialize QueryInterface.
 * @param {Array} category_entries
 *    An array of arguments for addCategoryEntry().
 * @constructor
 */
var Singleton_class = function( class_description, class_ID, contract_ID, interfaces, category_entries )
{
  this.class_description = class_description;
  this.class_ID = class_ID;
  this.contract_ID = contract_ID;
  this._xpcom_categories = category_entries;

  /**
   * Standard QI function from the XPCOM utility module.
   * @type {Function}
   */
  this.QueryInterface = XPCOMUtils.generateQI( interfaces );
};

/**
 * Initialization
 * @private
 */
Singleton_class.prototype.init = function()
{
  let registrar = Components.manager.QueryInterface( Ci.nsIComponentRegistrar );
  registrar.registerFactory( this.class_ID, this.class_description, this.contract_ID, this );

  let category_manager = Cc["@mozilla.org/categorymanager;1"].getService( Ci.nsICategoryManager );
  for ( let c of this._xpcom_categories )
  {
    //noinspection JSUnusedAssignment
    category_manager.addCategoryEntry( c.category, c.entry, this.contract_ID, false, true );
  }
  onShutdown.add( Singleton_class._deinit.bind( this ) );
};

/**
 * De-initialization function, run at shutdown time.
 *
 * This is a separate function to avoid using a closure for registering the shutdown hook.
 *
 * @private
 */
Singleton_class._deinit = function()
{
  let category_manager = Cc["@mozilla.org/categorymanager;1"].getService( Ci.nsICategoryManager );
  for ( let c of this._xpcom_categories )
  {
    //noinspection JSUnusedAssignment
    category_manager.deleteCategoryEntry( c.category, c.entry, false );
  }

  let registrar = Components.manager.QueryInterface( Ci.nsIComponentRegistrar );
  registrar.unregisterFactory( this.class_ID, this );
};

/**
 * Standard createInstance implementation for a singleton, returning 'this' rather than a new object.
 */
Singleton_class.prototype.createInstance = function( outer, iid )
{
  if ( outer )
    throw Cr.NS_ERROR_NO_AGGREGATION;
  return this.QueryInterface( iid );
};


//-----------------------------------------------------------------------------------------
// exports
//-----------------------------------------------------------------------------------------

var Bootstrap_XPCOM = {
  Singleton_class: Singleton_class
};
exports.Bootstrap_XPCOM = Bootstrap_XPCOM;
