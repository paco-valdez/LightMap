/*
<beginLegalBanter>
The MIT License (MIT)
Copyright (c) 2012 Francisco Valdez de la Fuente
Copyright (c) 2011 Charlie Andrews
Copyright (c) 2007 Klokan Petr Pridal


Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files 
(the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, 
merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is 
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES 
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE 
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR 
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
</endLegalBanter>

Special thanks to Klokan Petr Pridal.
for the software that converts a raster into TMS tiles, and creates KML SuperOverlay EPSG:4326
in the GDAL2Tiles project from the Google Summer of Code 2007 & 2008. klokan at klokan dot cz

Also thanks to Charlie Andrews.
For the SpryMap widget that makes scrollable divs.
*/

/*


  TO-DO:
    * Add pinch(in/out) touch events.
    * Identation fixes.
    * Add comments to explain the code.
    * Add aditional layers.



  Usage:
    map = new LightMap({
                          id : "mapcanvas",
                          height : 600,
                          width : 800,
                          zoom : 14,
                          center : {lon:-99.15262006530759,lat:19.379173823369506},
                          controls : true,
                          container : "container" 
                        });

  Available Parameters:
    id : wrapping map div id, obligatory
    container : parent div id of the map, obligatory.
    center : center of the map in lat-lon coordinates default {lon:-99.17158864746091,lat:19.424792788880602}
    zoom : initial map zoom, default 15
    width : initial width of the map, default 800
    height : initial height of the map, default 600
    tileSize : size of the tiles in pixels, default 256
    scrolling : if false disables map scrolling thus the map is fixed to the initial position, default True
    scrollTime : The time (in ms) that the above scrolling lasts, default 300
    controls : if true shows zoom in and zoom out controls, default True
    loading : URL of the "loading" image. default 'resources/loading_caption.png'
    divID :  Name of the scrollable div that will be created, default viewingBox
    cssClass : The CSS class attached to the wrapping map div.
    getURL(zoom,x,y) : Function that will override the default openstreetmaps tiles retrieving function. 

*/

/*

    What do we need to make an API like OpenLayers?, well we need to calculate the 
    coordinates from every tile we want to show as defined in Tile Map Service (TMS) Profiles

    Pixel and tile coordinates are in TMS notation (origin [0,0] in bottom-left).

    What coordinate conversions do we need for TMS Global Mercator tiles?:

         LatLon      <->       Meters      <->     Pixels    <->       Tile     

     WGS84 coordinates   Spherical Mercator  Pixels in pyramid  Tiles in pyramid
         lat/lon            XY in metres     XY pixels Z zoom      XYZ from TMS 
        EPSG:4326           EPSG:900913                                         
         .----.              ---------               --                TMS      
        /      \     <->     |       |     <->     /----/    <->      Google    
        \      /             |       |           /--------/          QuadTree   
         -----               ---------         /------------/                   
       KML, public         WebMapService         Web Clients      TileMapService

    What is the coordinate extent of Earth in EPSG:900913?

      [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244]
      Constant 20037508.342789244 comes from the circumference of the Earth in meters,
      which is 40 thousand kilometers, the coordinate origin is in the middle of extent.
      In fact you can calculate the constant as: 2 * math.pi * 6378137 / 2.0
      $ echo 180 85 | gdaltransform -s_srs EPSG:4326 -t_srs EPSG:900913
      Polar areas with abs(latitude) bigger then 85.05112878 are clipped off.

    What are zoom level constants (pixels/meter) for pyramid with EPSG:900913?

      whole region is on top of pyramid (zoom=0) covered by 256x256 pixels tile,
      every lower zoom level resolution is always divided by two
      initialResolution = 20037508.342789244 * 2 / 256 = 156543.03392804062

    What is the difference between TMS and Google Maps/QuadTree tile name convention?

      The tile raster itself is the same (equal extent, projection, pixel size),
      there is just different identification of the same raster tile.
      Tiles in TMS are counted from [0,0] in the bottom-left corner, id is XYZ.
      Google placed the origin [0,0] to the top-left corner, reference is XYZ.
      Microsoft is referencing tiles by a QuadTree name, defined on the website:
      http://msdn2.microsoft.com/en-us/library/bb259689.aspx

    The lat/lon coordinates are using WGS84 datum, yeh?

      Yes, all lat/lon we are mentioning should use WGS84 Geodetic Datum.
      Well, the web clients like Google Maps are projecting those coordinates by
      Spherical Mercator, so in fact lat/lon coordinates on sphere are treated as if
      the were on the WGS84 ellipsoid.
     
      From MSDN documentation:
      To simplify the calculations, we use the spherical form of projection, not
      the ellipsoidal form. Since the projection is used only for map display,
      and not for displaying numeric coordinates, we don't need the extra precision
      of an ellipsoidal projection. The spherical projection causes approximately
      0.33 percent scale distortion in the Y direction, which is not visually noticable.
*/


// We will need some misc array handling functions: 

if(!Array.prototype.indexOf){
    Array.prototype.indexOf= function(what, i){
        i= i || 0;
        var L= this.length;
        while(i< L){
            if(this[i]=== what) return i;
            ++i;
        }
        return -1;
    }
}


Array.prototype.remove= function(){
    var what, a= arguments, L= a.length, ax;
    while(L && this.length){
        what= a[--L];
        while((ax= this.indexOf(what))!= -1){
            this.splice(ax, 1);
        }
    }
    return this;
}


//end requeriments
var LightMap = function(){

  //Static Private Variables:
  //var LightMap.originShift = 2 * Math.PI * 6378137 / 2.0; // 20037508.342789244 //changed as public static vairable

  var constructor = function LightMap(param) {
    var m = this; //instance reference (m is for map)
    

    // Private Instance Functions:
    /**
     * Private Function:        checkMarkers()
     * Description: Check if onhold markers can be drawn
     *
     * Parameters:  
     */
    function checkMarkers(){
      for(var i=0;i<m.markers.length;i++){
        m.markers[i].boundsChanged();
      }
    }
    
    /**
     * Private Function:        boundsChanged()
     * Description: handle the change of the bounds
     *
     * Parameters:  
     */
    function boundsChanged(){
      checkMarkers();
    }
    
    
    /**
     * Private Function:        reallocateMap()
     * Description: Function that repaints the map to a given X and Y offset.
     *              
     * Parameters:  x - The new x offset of the map
     *              y - The new y offset of the map
     */
    function reallocateMap(x,y){
      if((x==0 && y==0) || m.reallocating)
        return;
      m.reallocating = true;
      var addedSize = 1;
      var newXsize = m.XnumberOfTiles+ (x!=0?addedSize:0);
      var newYsize = m.YnumberOfTiles+ (y!=0?addedSize:0);
      var ii = x*addedSize;
      var jj = y*addedSize;
      m.Xcenter += ii;
      m.Ycenter += jj;
      m.center.x += ii;
      m.center.y += jj;
      if(x<0)
        m.leftEdge += ii*m.tileSize*(-1);
      if(y<0)
        m.bottomEdge += jj*m.tileSize*(-1);
      if(x>0)
        m.rightEdge += ii*m.tileSize;
      if(y>0)
        m.topEdge += jj*m.tileSize;
      // reallocate new array, copy loaded tiles and create new tiles
      var tiles = new Array();
      for (var i = 0; i < newXsize; i++) {
        tiles.push(new Array());
        for (var j = 0; j < newYsize; j++) {
          var xx = m.center.x - m.Xcenter+i+ii+m.minX;
          var yy = m.center.y - m.Ycenter+j+jj+m.minY;
          if(i+ii>=0 && i+ii<m.XnumberOfTiles && j+jj<m.YnumberOfTiles && j+jj>=0)
            tiles[i].push(m.tiles[i+ii][j+jj]);
          else{
            tiles[i].push(initTile(m.map, m.zoom, xx, yy, i+ii+m.minX, j+jj+m.minY));
            m.getTile(tiles[i][j], m.zoom, xx, yy, i+ii+m.minX, j+jj+m.minY);
          }
          if(i==0 && j == 0){
            var p = {x:xx,y:yy};
            if(!m.tms)
              p = LightMap.GoogleTile(xx, yy, m.zoom) //Convert again to google tile to return to TMS
            var bound = LightMap.TileLatLonBounds(p.x, p.y, m.zoom, m.tileSize, m.initialResolution) //[ pmin.lat, pmin.lon, pmax.lat, pmax.lon ]
            m.bounds[2]=bound[2] //max lat
            m.bounds[1]=bound[1] //min lon
            m.boundsTMS[2] = xx
            m.boundsTMS[1] = yy
            bound = null;
          } else if(i+1 == newXsize && j+1 == newYsize){
            var p = {x:xx,y:yy};
            if(!m.tms)
              p = LightMap.GoogleTile(xx, yy, m.zoom) //Convert again to google tile to return to TMS
            var bound = LightMap.TileLatLonBounds(p.x, p.y, m.zoom, m.tileSize, m.initialResolution) //[ pmin.lat, pmin.lon, pmax.lat, pmax.lon ]
            m.bounds[0]=bound[0] //min lat
            m.bounds[3]=bound[3] //max lon
            m.boundsTMS[0] = xx
            m.boundsTMS[3] = yy
            bound = null;
          }
        }
      }
      m.XnumberOfTiles = newXsize;
      m.YnumberOfTiles = newYsize;
      m.tiles = null;
      m.tiles = tiles;
      if(x<0)
        m.minX += ii;
      if(y<0)
        m.minY += jj;
      boundsChanged();//handle bounds change event before allowing a new reallocation
      m.reallocating = false;
    }

    /**
     * Private Function:        MoveMap()
     * Description: Function that moves the map to a given X and Y offset.
     *              Note that the function takes into account locked edges in the
     *              map.
     * Parameters:  x - The new x offset of the map
     *              y - The new y offset of the map
     */
    function MoveMap(x, y) {
      if(m.movingMap)
        return
      try{
          var newX = x, newY = y, xSteps = 0, ySteps = 0;
          if(newX < -m.rightEdge){
            newX = -m.rightEdge;
             xSteps = 1;
          }
          if(newY < -m.topEdge){
            newY =  -m.topEdge;
            ySteps = 1;
          }
          if(newX > m.leftEdge){
            newX = m.leftEdge;
            xSteps = -1;
          }
          if(newY > m.bottomEdge){
            newY = m.bottomEdge;
            ySteps = -1;
          }
          reallocateMap(xSteps,ySteps);
          m.map.style.left = newX + "px";
          m.map.style.top = newY + "px";
          m.xOffset = newX;
          m.yOffset = newY;
      }catch(err){
        alert(err)
      }
    }

    /**
     * Private Function:        loadRing
     * Description: Recursive function that renders the map tiles in a concentric order starting in the center of the map
     * Parameters:  
     *              r - ring order, where 1 is the tile in the center
     *              xSize,ySize - Number of tiles that fits in the viewport
     *              x,y - Position of the center of the map
     */
    function loadRing(r,xSize,ySize,x,y){
      var size = (r*2)-1;
      if( (size>xSize && size>ySize && xSize%2!=0 && ySize%2!=0) || (size>xSize+1 && size>ySize && xSize%2==0 && ySize%2!=0) || (size>xSize && size>ySize+1 && xSize%2!=0 && ySize%2==0) || (size>xSize+1 && size>ySize+1 && xSize%2==0 && ySize%2==0) )
        return;
      if(r<2){
        if(r==1)
          m.getTile(m.tiles[x][y], m.zoom, m.center.x - m.Xcenter + x, m.center.y - m.Ycenter + y, x, y);
      }else{
        for (var i = x-r+1; i < x+r; i++) {
          for (var j = y-r+1; j < y+r; j++) {
            if(i<xSize && j<ySize && (i== x-r+1 || i==x+r-1 || j==y-r+1 || j==y+r-1)  && i>=0 && j>=0){
              m.getTile(m.tiles[i][j], m.zoom, m.center.x - m.Xcenter + i, m.center.y - m.Ycenter + j, i, j);
            }
          }
        }
      }
      loadRing(r+1,xSize,ySize,x,y);
    }

    /**
     * Private Function:        getTile
     * Description: Initializes and render a given tile in the viewport
     * Parameters:  
     *              container
     *              zoom,x,y - in tiles à la google coordinates
     *              xpos, ypos - position of the tile within the viewport
     */
    function initTile(container,zoom,x,y,xpos,ypos){
      xpos = parseInt(xpos*m.tileSize)+"px";
      ypos = parseInt(ypos*m.tileSize)+"px";
      var subcontainer = new Array();
      var img = document.createElement("img");
      img.src = m.loading;
      img.style.left=xpos;
      img.style.top=ypos;
      img.style.position = "absolute";
      img.style.zIndex=0;
      subcontainer.push(img);
      container.appendChild(img);
      return subcontainer;
    }
    
    //Public instance functions:
    /**
     * Public Function:        withInViewport()
     * Description: Checks if a coordinate is within the viewport bounds.
     *
     * Parameters:  lat - Longitude
     *              lon - Latitude
     */
    this.withInViewport = function(lat,lon){
      if(!m.withinBounds(lat,lon))
        return false
      var pos = LightMap.LatLonToPixels(lat,lon,m.zeroTile.x,m.zeroTile.y,m.zoom,m.tms,m.tileSize,m.initialResolution)
      return pos.x > (0-1)*m.xOffset && pos.x < m.width+((0-1)*m.xOffset) && pos.y > (0-1)*m.yOffset && pos.y < m.height+((0-1)*m.yOffset)
    }


    /**
     * Public Function:        moveMap() Alias of MoveMap but with x,y in tiles units instead of pixels
     * Description: Function that moves the map to a given X and Y offset.
     *              Note that the function takes into account locked edges in the
     *              map.
     * Parameters:  x - The new x offset of the map
     *              y - The new y offset of the map
     */
    this.moveMap = function (x ,y){
      
      MoveMap(parseInt(m.xOffset + (x*(-m.tileSize))), parseInt(m.yOffset + (y*(-m.tileSize))) );
      m.fireEvent("idle");
    }
    
    /**
     * Public Function:        AddListener()
     * Description: Adds an event listener to the specified element.
     * Parameters:  element - The element for which the listener is being added
     *              event - The event for which the listener is being added
     *              f - The function being called each time that the event occurs
     */
    this.AddListener =  function (element, event, f) {
        if(element.attachEvent) {
            element["e" + event + f] = f;
            element[event + f] = function () {
                element["e" + event + f](window.event)
            };
            element.attachEvent("on" + event, element[event + f])
        } else element.addEventListener(event, f, false)
    }
    
    /**
     * Public Function:        removeListener()
     * Description: Removes an event listener to the specified element.
     * Parameters:  element - The element for which the listener is being added
     *              event - The event for which the listener is being added
     *              f - The function being called each time that the event occurs
     */
    this.removeListener =  function (element, event,handler) {
        if(element.detachEvent) {
                element.detachEvent("on"+event, element[event + handler]);
                element[event + handler] = null;
            } else {
                element.removeEventListener(event, handler, false);
        }
    }

    /**
     * Public Function:        fireEvent()
     * Description: Fires an event listener to the whole document.
     * Parameters:  eventName - The event is being fired
     */
    this.fireEvent = function (eventName){
      if (document.addEventListener) {
        var fakeEvent = document.createEvent("UIEvents");
        fakeEvent.initEvent(eventName, false, false);
        document.dispatchEvent(fakeEvent);
      } else if (document.attachEvent) {
        document.documentElement[eventName]++;
      }
    } 

    /**
     * Public Function:        addCustomEvent
     * Description: Adds an event listener to the document.
     * Parameters:  eventName - The event for which the listener is being added
     *              handler - The function being called each time that the event occurs
     */
    this.addCustomEvent = function (eventName, handler){
      if (document.addEventListener) {
        document.addEventListener(eventName, function(e) {
          // execute the callback
          handler(e);
        }, false);
      } else if (document.attachEvent) { // MSIE
        document.documentElement[eventName] = 0; // an expando property
        document.documentElement.attachEvent("onpropertychange", function(event) {
          if (event.propertyName == eventName) {
            // execute the callback
            handler(event);
          }
        });
      }
    }
    
    /**
     * Public Function:        getURL
     * Description: Default function to get the url of a tile
     * Parameters:  zoom,x,y in tiles à la google coordinates
     */
    this.getURL = function(zoom,x,y){
      var myArray = ['a','b','c'];
      var rand = myArray[Math.floor(Math.random() * myArray.length)];
      return 'http://'+rand+'.tile.openstreetmap.org/'+zoom+'/'+x+'/'+y+'.png';
    }


    /**
     * Public Function:        getTile
     * Description: Renders a given tile in the viewport
     * Parameters:  
     *              container
     *              zoom,x,y - in tiles à la google coordinates
     *              xpos, ypos - position of the tile within the viewport
     */
    this.getTile = function (container,zoom,x,y,xpos,ypos){
      xpos = parseInt(xpos*m.tileSize)+"px";
      ypos = parseInt(ypos*m.tileSize)+"px";
      var img = document.createElement("img");
      img.src = m.getURL(zoom,x,y);
      img.style.zIndex=0;
      img.style.left=xpos;
      img.style.top=ypos;
      img.name = "default";
      img.style.position = "absolute";
      if(m.firsttime)
        img.id = "default"+zoom+'_'+x+'_'+y
      while (container.length>0){
        container[0].parentNode.removeChild(container[0]);
        container.remove(container[0]);
      }
      m.map.appendChild(img);
      container.push(img);
      
      //to-do, add aditional layers
      /** for layer in layers:
      img = document.createElement("img");
      img.src = layer.getURL(zoom,x,y);
      img.style.zIndex=1;
      img.style.left=xpos;
      img.style.top=ypos;
      img.style.position = "absolute";
      img.name = layer.name;
      if(m.firsttime)
        img.id = layer.name+zoom+'_'+x+'_'+y
      m.map.appendChild(img);
      container.push(img);
      **/ 
      return;
    }

    /**
     * Public Function:        getAllTiles
     * Description: Renders the map tiles and fires the "idle" event when it finishes
     * Parameters:  
     */
    this.getAllTiles = function(){
      loadRing(1, m.XnumberOfTiles, m.YnumberOfTiles, parseInt(m.XnumberOfTiles/2), parseInt(m.YnumberOfTiles/2));
      m.setCenter(m.WGScenter.lat,m.WGScenter.lon);
      m.fireEvent("idle");
    }
    

    /**
     * Public Function:        withinBounds
     * Description: Returns true if a coordinate is within the rendered map, false otherwise
     * Parameters:  
     *              lat,lon - coordinates in WGS84 datum
     */
    this.withinBounds = function(lat,lon){
      if( lat >= m.bounds[0] && lat <= m.bounds[2] && lon >= m.bounds[1] && lon <= m.bounds[3])
        return true
      return false
    }
    
    /**
    * Public Function:        getCenter() 
    * Description: returns the center of the map in WGS84 coordinates
    * Parameters:  
    */
    this.getCenter = function () {
      var p = {x:m.zeroTile.x,y:m.zeroTile.y};
      if(!m.tms)
        p = LightMap.GoogleTile(m.zeroTile.x, m.zeroTile.y, m.zoom) //Convert again to google tile to return to TMS
      var bound = LightMap.TileLatLonBounds(p.x, p.y, m.zoom, m.tileSize, m.initialResolution)
      var lat = bound[2] - (  (bound[2]-bound[0])/m.tileSize*( (m.yOffset*(-1.0)) + (m.height/2.0) )  );//lat
      var lon = bound[1] + (  (bound[3]-bound[1])/m.tileSize*( (m.xOffset*(-1.0)) + (m.width/2.0) )  );// lon
      return {lat:lat,lon:lon}
    };
    
    /**
    * Public Function:        zoomIn() 
    * Description: zooms in 
    * Parameters:  
    */
    this.zoomIn = function () {
      var center = m.getCenter();
      m.setCenter(center.lat , center.lon , m.zoom+1);
    };
    
    /**
    * Public Function:        zoomOut() 
    * Description: zooms out 
    * Parameters:  
    */
    this.zoomOut = function () {
      var center = m.getCenter();
      m.setCenter(center.lat , center.lon , m.zoom-1);
    };
    
    /**
      * Public Function:        setCenter() 
      * Description: Centers the map to a given lat lon position
      * Parameters:  lat - The new y offset of the map
      *              lon - The new x offset of the map
      *              zoom - zoom level of the new center (optional)
      * 
      */
    this.setCenter = function (lat ,lon, zoom){
      //there are two options:
      //the new coordinate is within our already rendered tiles or not.
      zoom = typeof zoom == "undefined" ?  m.zoom : zoom;
      if(m.withinBounds(lat,lon) && zoom==m.zoom){//new coordinate is within bounds and same zoom
        //lets find out how many pixels we have to add from the 0,0 pixel cordinate of the screen
        var pos = LightMap.LatLonToPixels(lat,lon,m.zeroTile.x,m.zeroTile.y,zoom,m.tms,m.tileSize,m.initialResolution);
        var xOffsetCenter = (parseInt(pos.x) - parseInt(m.width/2))*(-1);
        var yOffsetCenter = (parseInt(pos.y) - parseInt(m.height/2))*(-1);
        MoveMap(xOffsetCenter , yOffsetCenter);        
      }else{
        m.reallocateMap(lat,lon,zoom,false);
      }
    }

    /**
      * Public Function:        calculateSize
      * Description: calculates the number of tiles required to fill the viewport
      * Parameters: 
      */
    this.calculateSize = function(){
      m.XnumberOfTiles = parseInt(m.width/m.tileSize)+1;
      m.YnumberOfTiles = parseInt(m.height/m.tileSize)+1;
      if(m.XnumberOfTiles==1)
        m.XnumberOfTiles=3;
      if(m.YnumberOfTiles==1)
        m.YnumberOfTiles=3;
      m.XnumberOfTiles = parseFloat(m.XnumberOfTiles)%2.0==0.0 ? m.XnumberOfTiles + 1 : m.XnumberOfTiles;
      m.YnumberOfTiles = parseFloat(m.YnumberOfTiles)%2.0==0.0 ? m.YnumberOfTiles + 1 : m.YnumberOfTiles;
      m.Xcenter = parseInt(parseFloat(m.XnumberOfTiles)/2.0);
      m.Ycenter = parseInt(parseFloat(m.YnumberOfTiles)/2.0);
      m.rightEdge = parseInt(m.XnumberOfTiles*m.tileSize)-m.width;
      m.topEdge = parseInt(m.YnumberOfTiles*m.tileSize)-m.height;
      m.leftEdge = 0;
      m.bottomEdge = 0;
      m.minX = 0;
      m.minY = 0;
      m.mousePosition = new Coordinate;
      m.mouseLocations = [];
      m.velocity = new Coordinate;
      m.timerId = -1;
      m.timerCount = 0;
    }

    /**
      * Public Function:        reallocateMap
      * Description: Moves the map to a given postion and zoom
      * Parameters: lat,lon - coordinates in WGS84 datum
      *             zoom
      *             lazy - if true, the function doesn't loads the tiles of the new position 
      */
    this.reallocateMap = function (lat,lon,zoom,lazy){
      m.reallocating = true;
      m.movingMap = true;
      lazy = typeof lazy == "undefined" ? false : lazy;
      for (var i = 0; i < m.tiles.length; i++) {
        for (var j = 0; j < m.tiles[i].length; j++) {
          for (var k = 0; k < m.tiles[i][j].length; k++) {
            m.tiles[i][j][k].parentNode.removeChild(m.tiles[i][j][k]);
            m.tiles[i][j]=new Array();
          }
        }
      }
      m.map = document.getElementById(param.id);
      m.map.innerHTML="";
      m.WGScenter.lat = lat;
      m.WGScenter.lon = lon;
      m.zoom = zoom;

      m.calculateSize();

      if(m.mouseDown) {
            var handler = MouseMove;
            m.removeListener(document,"mousemove",handler);
      }
      m.mouseDown = false;
      
      m.center = LightMap.LatLonToTile(lat, lon, zoom, m.tms, m.tileSize,m.initialResolution);
      //m.tiles = new Array(m.XnumberOfTiles);
      m.tiles = new Array();
      for (var i = 0; i < m.XnumberOfTiles; i++) {
        //m.tiles[i] = new Array(m.YnumberOfTiles);
        m.tiles.push(new Array());
        for (var j = 0; j < m.YnumberOfTiles; j++) {
          var x = m.center.x - m.Xcenter + i;
          var y = m.center.y - m.Ycenter + j;
          m.tiles[i].push(initTile(m.map, zoom, x, y, i, j));
          if(i==0 && j == 0){
            m.zeroTile.x=x;
            m.zeroTile.y=y;
            var p = {x:x,y:y};
            if(!m.tms)
              p = LightMap.GoogleTile(x, y, zoom) //Convert again to google tile to return to TMS
            var bound = LightMap.TileLatLonBounds(p.x, p.y, zoom, m.tileSize, m.initialResolution ) //[ pmin.lat, pmin.lon, pmax.lat, pmax.lon ]
            m.bounds[2]=bound[2] //max lat
            m.bounds[1]=bound[1] //min lon
            m.boundsTMS[2] = x
            m.boundsTMS[1] = y
            bound = null;
          } else if(i+1 == m.XnumberOfTiles && j+1 == m.YnumberOfTiles){
            var p = {x:x,y:y};
            if(!m.tms)
              p = LightMap.GoogleTile(x, y, zoom) //Convert again to google tile to return to TMS
            var bound = LightMap.TileLatLonBounds(p.x, p.y, zoom, m.tileSize, m.initialResolution ) //[ pmin.lat, pmin.lon, pmax.lat, pmax.lon ]
            m.bounds[0]=bound[0] //min lat
            m.bounds[3]=bound[3] //max lon
            m.boundsTMS[0] = x
            m.boundsTMS[3] = y
            bound = null;
          }
        }
      }
      boundsChanged();
      m.reallocating = false;
      m.movingMap = false;
      if(!lazy){
        m.getAllTiles();
      }
    }

    /**
     * Private Function:        MouseMove()
     * Description: Function called every time that the mouse moves
     */
    var MouseMove = function (b) {
        var e = b.clientX - m.mousePosition.x + parseInt(m.map.style.left),
            d = b.clientY - m.mousePosition.y + parseInt(m.map.style.top);
        MoveMap(e, d);
        m.mousePosition.x = b.clientX;
        m.mousePosition.y = b.clientY
    };

    /**
     * Private Function:        OnScrollTimer()
     * Description: Function called every time that the scroll timer fires
     */
    var OnScrollTimer = function () {
        //console.log("timer")
        if(m.mouseDown) {
            // Keep track of where the latest mouse location is
            m.mouseLocations.unshift(new Coordinate(m.mousePosition.x, m.mousePosition.y));
            // Make sure that we're only keeping track of the last 10 mouse
            // clicks (just for efficiency)
            if(m.mouseLocations.length > 10)
                m.mouseLocations.pop();
        } else {
            var totalTics = m.scrollTime / 20;
            var fractionRemaining = (totalTics - m.timerCount) / totalTics;
            var xVelocity = m.velocity.x * fractionRemaining;
            var yVelocity = m.velocity.y * fractionRemaining;
            MoveMap(-xVelocity + parseInt(m.map.style.left),
                    -yVelocity + parseInt(m.map.style.top));
            // Only scroll for 20 calls of this function
            if(m.timerCount >= totalTics || typeof fractionRemaining == "undefined") {
                clearInterval(m.timerId);
                m.timerId = -1
                m.fireEvent("idle");
            }
            ++m.timerCount;
        }
    };

    /**
     * Private Function:        mousewheel()
     * Description: mousewheel event handler
     */
    this.mousewheel = function(e){
      if(m.mousewheelZooming){
        var e = window.event || e; // old IE support
        var delta = Math.max(-1, Math.min(1, (e.wheelDelta || -e.detail)));
        if(delta>0){
          m.zoomIn();
        }else{
          m.zoomOut();
        }
      }
    }

    /**
      * Public Function:        moveToPosition
      * Description: Moves the map to a given pixel position
      * Parameters:  x,y - Pixel coordinates
      * 
      */
    this.moveToPosition = function (x,y){
      var w = m.width;
      var h = m.height;
      m.mousePosition.x = x;
      m.mousePosition.y = y;
      var t = 0.15;     //threshold
      var step = 0.05;
      
      if(x < w*t )
        m.moveMap(-step,0)
      if(x > w*(1-t))
        m.moveMap(step,0)
      if(y < h*t )
        m.moveMap(0,-step)
      if(y > h*(1-t))
        m.moveMap(0,step)
    }
    
    /**
      * Public Function:        mouseover
      * Description: mouseover event handler
      * Parameters:  b - mouseover event 
      */
    this.mouseover = function (b) {
      var x = b.clientX;
      var y = b.clientY;
      m.mousePosition.x = b.clientX;
      m.mousePosition.y = b.clientY;
      m.moveToPosition(x,y);
    };
    
    /**
      * Public Function:        click
      * Description: click event handler
      * Parameters:  b - click event 
      */
    this.click = function (b) {
      m.moveToPosition(b.clientX,b.clientY)
    }

    /**
      * Public Function:        mousedown
      * Description: mousedown event handler
      * Parameters:  b - mousedown event 
      */
    this.mousedown = function (e) {
        m.viewingBox.style.cursor = "url(data:image/x-win-bitmap;base64,AAACAAEAICACAAcABQAwAQAAFgAAACgAAAAgAAAAQAAAAAEAAQAAAAAAAAEAAAAAAAAAAAAAAgAAAAAAAAAAAAAA////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8AAAA/AAAAfwAAAP+AAAH/gAAB/8AAAH/AAAB/wAAA/0AAANsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////////////////////////////////////////////////////////////////////////////////////gH///4B///8Af//+AD///AA///wAH//+AB///wAf//4AH//+AD///yT/////////////////////////////8=), default";
        // Save the current mouse position so we can later find how far the
        // mouse has moved in order to scroll that distance
        m.mousePosition.x = e.clientX;
        m.mousePosition.y = e.clientY;
        // Start paying attention to when the mouse moves
        m.AddListener(document, "mousemove", MouseMove);
        m.mouseDown = true;
        // If the map is set to continue scrolling after the mouse is released,
        // start a timer for that animation
        if(m.scrolling) {
            m.timerCount = 0;
            if(m.timerId <= 0)
            {
                clearInterval(m.timerId);
                m.timerId = 0;
                m.timerId = setInterval(OnScrollTimer, 20);
            }
            
        }else{
          m.fireEvent("idle");
        }
        e.preventDefault();
    }

    /**
      * Public Function:        mouseup
      * Description: mouseup event handler
      * Parameters:  b - mouseup event 
      */
    this.mouseup = function () {
      if(m.mouseDown) {
        var handler = MouseMove;
        m.removeListener(document,"mousemove",handler);
        m.mouseDown = false;
        if(m.mouseLocations.length > 0) {
          var clickCount = m.mouseLocations.length;
          m.velocity.x = (m.mouseLocations[clickCount - 1].x - m.mouseLocations[0].x) / clickCount;
          m.velocity.y = (m.mouseLocations[clickCount - 1].y - m.mouseLocations[0].y) / clickCount;
          m.mouseLocations.length = 0;
        }
      }
      if(m.timerId <= 0)
      {
          m.fireEvent("idle");
      }
      //console.log(m.bounds);
      /*if(!m.scrolling){
        m.fireEvent("idle");
      }*/
      m.viewingBox.style.cursor = "auto";
    }

    /**
     * Private class: Coordinate
     * Description: Coordinate object in tile à la google units
     * Parameters:  startX 
     *              startY
     */
    function Coordinate(startX, startY) {
        this.x = startX;
        this.y = startY;
    }

    /**
     * Public class: Marker
     * Description: Coordinate object in tile à la google units
     * Parameters:  {
                      src - Icon URL
                      xoffset - # of pixels to displace the Icon
                      yoffset
                    } 
     *              
     */ 
    this.Marker = function (param2){
      var _this = this;
      
      /**
       * Public Function:        Marker.draw()
       * Description: Function that puts the marker on the map
       */
      _this.draw=function(){
        //lets find out how many pixels we have to add from the 0,0 pixel cordinate of the screen
        var pos = LightMap.LatLonToPixels(lat,lon,m.zeroTile.x,m.zeroTile.y,m.zoom,m.tms,m.tileSize,m.initialResolution);
        var img = typeof _this.img == "undefined" || _this.img == null ?  document.createElement("img") :  _this.img;
        //var img = document.createElement("img");
        img.src = src;
        img.style.zIndex=3;
        img.style.left=parseInt(pos.x - xoffset)+"px";
        img.style.top=parseInt(pos.y - yoffset)+"px";
        img.style.position = "absolute";
        _this.img = img;
        _this.drawed = true;
        m.map.appendChild(img);
      }
      
      /**
      * Public Fuction:  removeFromMap
      * Description: Removes the marker from the map
      */
      _this.removeFromMap = function(){
        if(_this.img.parentNode)
          _this.img.parentNode.removeChild(_this.img);
        _this.img = null;
        _this.drawed = false;
      }
      
      /**
      * Public Fuction:  boundsChanged
      * Description: Checks if the Marker is within the bounds of the map 
      *               and draws it or removes it accordingly.
      */
      _this.boundsChanged = function(){
        if( _this.drawed){
          if(!m.withinBounds(lat,lon)){
            _this.removeFromMap();
            m.onHoldMarkers.push(_this);
          }else{
            //_this.removeFromMap();
            _this.draw();
          }
        }else{
          if(m.withinBounds(lat,lon)){
            m.onHoldMarkers.remove(_this);
            _this.draw();
          }
        }
      }
      
      /**
      * Public Fuction:  destroy
      * Description: Removes the marker from the map, and pops it from the markers array.
      */
      _this.destroy = function (){
        _this.removeFromMap();
        m.markers.remove(_this);
      }

      //there are two options:
      //the new coordinate is within our already rendered tiles or not.
      //first translate from lat,lon to x,y,z tiles à la google maps.
      
      var lat  = param2.lat;
      var lon  = param2.lon;
      var src = typeof param2.src == "undefined" ?  "resources/arrow.png" :  param2.src;
      var xoffset = typeof param2.xoffset == "undefined" ?  0 :  param2.xoffset;
      var yoffset = typeof param2.yoffset == "undefined" ?  0 :  param2.yoffset;
      _this.lat = lat;
      _this.lon = lon;
      _this.src = src;
      _this.drawed = false;
      _this.x=null;
      _this.y=null;
      if(m.withinBounds(lat,lon)){//new coordinate is within bounds
        _this.draw();
      }else{
        m.onHoldMarkers.push(_this);//store the marker if the marker is not within the visible area.
      }
      m.markers.push(_this);
    }
    
    //initial values
    m.firsttime= true;
    m.id=param.id;
    m.map = document.getElementById(param.id);
    m.map.innerHTML = "";
    m.WGScenter = typeof param.center == "undefined" ? {lon:-99.17158864746091,lat:19.424792788880602} : param.center;
    m.zoom = typeof param.zoom == "undefined" ? 15 : param.zoom;
    m.width = typeof param.width == "undefined" ? 800 : param.width;
    m.height = typeof param.height == "undefined" ? 600 : param.height;
    m.tileSize = typeof param.tileSize == "undefined" ? LightMap.tileSize : param.tileSize;
    m.scrolling = typeof param.scrolling == "undefined" ? true : param.scrolling;
    m.scrollTime = typeof param.scrollTime == "undefined" ? 300 : param.scrollTime;
    m.controls = typeof param.controls == "undefined" ? true : param.controls;
    m.container = typeof param.container == "undefined" ? "container" : param.container;
    m.loading = typeof param.loading == "undefined" ? 'resources/loading_caption.png' : param.loading;
    m.tms = typeof param.tms == "undefined" ? false : param.tms;
    m.mousewheelZooming = typeof param.mousewheelZooming == "undefined" ? true : param.mousewheelZooming;
    if(typeof param.getURL != "undefined") m.getURL = param.getURL;
    m.initialResolution = LightMap.InitialResolution(m.tileSize); // 156543.03392804062 for tileSize 256 pixels
    
    // UI initialization
    m.viewingBox = document.createElement("div");
    m.viewingBox.id = typeof param.divID == "undefined" ? "viewingBox" : param.divID;
    m.map.parentNode.replaceChild(m.viewingBox, m.map);
    m.viewingBox.appendChild(m.map);
    m.viewingBox.style.overflow = "hidden";
    m.viewingBox.style.width = m.width + "px";
    m.viewingBox.style.height = m.height + "px";
    m.viewingBox.style.position = "relative";
    m.over = false;
    if(m.controls){
      //var container = document.getElementById(m.container);
      var container = m.viewingBox.parentNode;
      //Zoom in
      var img = document.createElement("img");
      img.src = 'resources/plus.png';
      img.id="zoominbutton";
      img.style.zIndex=5;
      img.style.left=parseInt(m.width-55)+ "px";
      img.style.top=5+ "px";
      img.style.position = "absolute";
      m.AddListener(img, "click", m.zoomIn);
      container.appendChild(img);
      // Zoom out
      img = document.createElement("img");
      img.src = 'resources/minus.png';
      img.id="zoominout";
      img.style.zIndex=5;
      img.style.left=parseInt(m.width-55)+ "px";
      img.style.top=60+ "px";
      img.style.position = "absolute";
      m.AddListener(img, "click", m.zoomOut);
      container.appendChild(img);
    }
    m.map.style.position = "absolute";
    if(typeof param.cssClass != "undefined") m.viewingBox.className = param.cssClass;
    m.calculateSize();
    m.mouseDown = false;
    m.reallocating = false; 
    m.markers = new Array();
    m.onHoldMarkers = new Array();
    m.movingMap = false;
    m.tiles = new Array(1);
    m.tiles[0] = new Array();
    m.bounds = new Array(4);
    m.boundsTMS = new Array(4);
    m.latLonBounds = new Array(4);
    m.zeroTile = {};
    m.xOffsetCenter = (parseInt((m.XnumberOfTiles*m.tileSize)/2) - parseInt(m.width/2))*(-1);
    m.yOffsetCenter = (parseInt((m.YnumberOfTiles*m.tileSize)/2) - parseInt(m.height/2))*(-1);
    m.xOffset = m.xOffsetCenter;
    m.yOffset = m.yOffsetCenter;
    m.reallocateMap(m.WGScenter.lat, m.WGScenter.lon, m.zoom, true);
    //add mouse event listeners
    m.AddListener(m.viewingBox, "mousewheel", m.mousewheel);
    m.AddListener(m.viewingBox, "mousedown", m.mousedown);
    m.AddListener(document, "mouseup", m.mouseup);
    //m.AddListener(m.viewingBox, "mousemove", m.mouseover);
    m.AddListener(m.viewingBox, "click", m.click);
  };

  // Public Static Variables:

  constructor.tileSize = 256;
  constructor.initialResolution = 2 * Math.PI * 6378137 / constructor.tileSize;//156543.03392804062 for tileSize 256 pixels
  constructor.originShift = 2 * Math.PI * 6378137 / 2.0; // 20037508.342789244 

  // Public Static Methods;
  /**
     * Public Static Method:   LightMap.LatLonToMeters
     * Description: Converts given lat/lon in WGS84 Datum 
     *              to XY in Spherical Mercator EPSG:900913
     *
     * Parameters:  lat - Latitude
     *              lon - Longitude
     */
  constructor.LatLonToMeters = function( lat, lon ){
    var mx = lon * LightMap.originShift / 180.0 ;
    var my = Math.log( Math.tan((90 + lat) * Math.PI / 360.0 )) /  (Math.PI / 180.0);

    my = my * LightMap.originShift / 180.0;
    return {x:mx,y:my};
  };

  /**
   * Public Static Method:   LightMap.Resolution()
   * Description: Resolution (meters/pixel) for given zoom level (measured at Equator)
   *
   * Parameters:  zoom - zoom level
   *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution() 
   */
  constructor.Resolution = function(zoom, initialResolution){
    if(typeof initialResolution == "undefined")
      initialResolution = LightMap.initialResolution;
    return (initialResolution / parseFloat(Math.pow(2,zoom)));
  };

  /**
     * Public Static Method:  LightMap.MetersToPixels()
     * Description: Converts EPSG:900913 to pyramid pixel coordinates in given zoom level
     *
     * Parameters:  x - Longitude
     *              y - Latitude
     *              zoom - zoom level
     *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution() 
     */
  constructor.MetersToPixels = function(mx, my, zoom , initialResolution){
    if(typeof initialResolution == "undefined")
      initialResolution = LightMap.initialResolution;
    var res = LightMap.Resolution( zoom, initialResolution );
    var px = (mx + LightMap.originShift) / res;
    var py = (my + LightMap.originShift) / res;
    return {x:px,y:py};
  };

  /**
   * Public Static Method:  LightMap.PixelsToTile()
   * Description: Returns coordinates of the tile covering region in pixel coordinates
   *
   * Parameters:  x - Longitude
   *              y - Latitude
   *              zoom - zoom level
   *              tileSize - Defaults to LightMap.tileSize (256px)
   */
  constructor.PixelsToTile = function(px, py, tileSize){
      if(typeof tileSize == "undefined")
        tileSize = LightMap.tileSize;
      var tx = parseInt( Math.ceil( px / parseFloat(tileSize) ) - 1 );
      var ty = parseInt( Math.ceil( py / parseFloat(tileSize) ) - 1 );
      return {x:tx,y:ty};
  }

  /**
   * Public Static Method: LightMap.InitialResolution()
   * Description: Returns tile for given mercator coordinates
   *
   * Parameters:  mx - Longitude
   *              my - Latitude
   *              zoom - zoom level
   *              tileSize - defaults to LightMap.tileSize (256px)
   *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution()  
   *
   * Note: initialResolution argument shouldn't be necessary but is added for 
   *       optimization, don't provide it unless tile size other than 256.
   */
  constructor.MetersToTile = function(mx, my, zoom, tileSize, initialResolution){
    if(typeof tileSize == "undefined")
      tileSize = LightMap.tileSize;
    if(typeof initialResolution == "undefined"){
      if(tileSize == LightMap.tileSize)
        initialResolution = LightMap.initialResolution;
      else
        initialResolution = LightMap.InitialResolution(tileSize);
    }
    var p = LightMap.MetersToPixels( mx, my, zoom, initialResolution);
    return LightMap.PixelsToTile(p.x, p.y, tileSize);
  }

  /**
   * Public Static Method: LightMap.LatLonToTile()
   * Description: Returns tile for given mercator coordinates
   *
   * Parameters:  lat - Latitude
   *              lon - Longitude
   *              zoom - zoom level
   *              tms - use TMS or Google Tiles 
   *              tileSize - defaults to LightMap.tileSize (256)
   *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution() 
   *
   * Note: initialResolution argument shouldn't be necessary but is added for 
   *       optimization, don't provide it unless tile size other than 256.
   */
  constructor.LatLonToTile = function(lat, lon, zoom, tms, tileSize, initialResolution){
    if(typeof tileSize == "undefined")
      tileSize = LightMap.tileSize;
    if(typeof initialResolution == "undefined"){
      if(tileSize == LightMap.tileSize)
        initialResolution = LightMap.initialResolution;
      else
        initialResolution = LightMap.InitialResolution(tileSize);
    }
    var p = LightMap.LatLonToMeters( lat, lon );
    p = LightMap.MetersToTile( p.x, p.y, zoom, tileSize, initialResolution);
    if(tms)
      return p;
    else
      return LightMap.GoogleTile(p.x, p.y, zoom);
  }

  /**
   * Public Static Method: LightMap.InitialResolution()
   * Description: Calculates the initial resolution at zoom 0
   *
   * Parameters: tileSize - defaults to LightMap.tileSize (256)
   */
  constructor.InitialResolution = function(tileSize){
    if(typeof tileSize == "undefined")
      tileSize = LightMap.tileSize;
    if(tileSize == LightMap.tileSize)
      return LightMap.initialResolution;
    return 2 * Math.PI * 6378137 / tileSize;
  }

  /**
   * Public Static Method: LightMap.GoogleTile()
   * Description: Converts TMS tile coordinates to Google Tile coordinates
   *
   * Parameters:  tx - Longitude
   *              ty - Latitude
   *              zoom - zoom level
   */
  constructor.GoogleTile = function(tx, ty, zoom){
    //coordinate origin is moved from bottom-left to top-left corner of the extent
    return {x:tx,y: (Math.pow(2,zoom) - 1) - ty,ty:ty}
  }

  /**
    * Public Static Method: LightMap.LatLonToPixels()
    * Description: Gets the distance in pixels from a tile à la Google coordinates to a lat,lon coordinates
    * Parameters:  lat - The new y offset of the map
    *              lon - The new x offset of the map
    *              zoom - zoom level of the new center
    *              x - Longitude tile à la Google coordinate of the reference
    *              y - Latitude tile à la Google coordinate of the reference
    *              tms - use TMS or Google Tiles (default false)
    *              tileSize - defaults to LightMap.tileSize (256)
    *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution() 
    *
    * Note: initialResolution argument shouldn't be necessary but is added for 
    *       optimization, don't provide it unless tile size other than 256. aqui
    */
  constructor.LatLonToPixels = function (lat,lon,x,y,zoom,tms,tileSize,initialResolution){
    if(typeof tms == "undefined")
      tms = false;
    if(typeof tileSize == "undefined")
      tileSize = LightMap.tileSize;
    if(typeof initialResolution == "undefined"){
      if(tileSize == LightMap.tileSize)
        initialResolution = LightMap.initialResolution;
      else
        initialResolution = LightMap.InitialResolution(tileSize);
    }
    //first translate from lat,lon to x,y,z tiles à la google maps.
    var p = LightMap.LatLonToTile(lat, lon, zoom, tms, tileSize, initialResolution);
    var bounds = null;
    if(tms)
      bounds = LightMap.TileLatLonBounds(p.x, p.y ,zoom, tileSize, initialResolution);
    else
      bounds = LightMap.TileLatLonBounds(p.x, p.ty ,zoom, tileSize, initialResolution);
    //lets get the position of the point within the tile and then 
    //add the pixels from the tile we were given to the tile we want
    return {x: (( 1 - ((bounds[3]-lon)/(bounds[3]-bounds[1])))*tileSize) + ((p.x - x)*tileSize) , y: (((bounds[2]-lat)/(bounds[2]-bounds[0]))*tileSize) + ((p.y - y)*tileSize) };
  }

  /**
   * Public Static Method: LightMap.TileLatLonBounds()
   * Description: Returns bounds of the given tile in latitude/longitude using WGS84 datum
   *
   * Parameters:  tx - Longitude
   *              ty - Latitude
   *              zoom - zoom level
   *              tileSize - defaults to LightMap.tileSize (256)
   *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution() 
   *
   * Note: initialResolution argument shouldn't be necessary but is added for 
   *       optimization, don't provide it unless tile size other than 256. 
   */
  constructor.TileLatLonBounds = function(tx, ty, zoom, tileSize, initialResolution){
    if(typeof tileSize == "undefined")
      tileSize = LightMap.tileSize;
    if(typeof initialResolution == "undefined"){
      if(tileSize == LightMap.tileSize)
        initialResolution = LightMap.initialResolution;
      else
        initialResolution = LightMap.InitialResolution(tileSize);
    }
    var bounds = LightMap.TileBounds( tx, ty, zoom, tileSize, initialResolution);
    var pmin = LightMap.MetersToLatLon(bounds[0], bounds[1]);
    var pmax = LightMap.MetersToLatLon(bounds[2], bounds[3]);
     
    return [ pmin.lat, pmin.lon, pmax.lat, pmax.lon ];
  }

  /**
   * Public Static Method: LightMap.TileBounds()
   * Description: Returns bounds of the given tile in EPSG:900913 coordinates
   *
   * Parameters:  tx - Longitude
   *              ty - Latitude
   *              zoom - zoom level
   *              tileSize - defaults to LightMap.tileSize (256)
   *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution() 
   *
   * Note: initialResolution argument shouldn't be necessary but is added for 
   *       optimization, don't provide it unless tile size other than 256. 
   */
  constructor.TileBounds = function (tx, ty, zoom, tileSize, initialResolution){
    if(typeof tileSize == "undefined")
      tileSize = LightMap.tileSize;
    if(typeof initialResolution == "undefined"){
      if(tileSize == LightMap.tileSize)
        initialResolution = LightMap.initialResolution;
      else
        initialResolution = LightMap.InitialResolution(tileSize);
    }
    var pmin = LightMap.PixelsToMeters( tx*tileSize, ty*tileSize, zoom, initialResolution)
    var pmax = LightMap.PixelsToMeters( (tx+1)*tileSize, (ty+1)*tileSize, zoom, initialResolution)
    return [ pmin.x, pmin.y, pmax.x, pmax.y ];
  }

  /**
   * Public Static Method: LightMap.MetersToLatLon()
   * Description: Converts XY point from Spherical Mercator EPSG:900913 to lat/lon in WGS84 Datum
   *
   * Parameters:  mx - Longitude
   *              my - Latitude
   */
  constructor.MetersToLatLon = function (mx, my){
    var lon = (mx / LightMap.originShift) * 180.0;
    var lat = (my / LightMap.originShift) * 180.0;

    lat = 180 / Math.PI * (2 * Math.atan( Math.exp( lat * Math.PI / 180.0)) - Math.PI / 2.0);
    return {lat:lat,lon:lon};
  }

  /**
   * Public Static Method: LightMap.PixelsToMeters()
   * Description: Converts pixel coordinates in given zoom level of pyramid to EPSG:900913
   *
   * Parameters:  px - Longitude
   *              py - Latitude
   *              zoom - zoom level
   *              initialResolution - defaults to LightMap.initialResolution, check LightMap.InitialResolution() 
   *
   * Note: initialResolution argument shouldn't be necessary but is added for 
   *       optimization, don't provide it unless tile size other than 256. 
   */
  constructor.PixelsToMeters = function(px, py, zoom, initialResolution){
    if(typeof initialResolution == "undefined")
      initialResolution = LightMap.initialResolution;
    res = LightMap.Resolution(zoom, initialResolution);
    mx = px * res - LightMap.originShift;
    my = py * res - LightMap.originShift;
    return {x:mx,y: my};
  }

  return constructor;
}();