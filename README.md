LightMap
========

A Javascript Light Map API


Usage:
-------------

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
-------------

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


History
-------------

    I needed a maps API that was compatible with old Blackberry devices, so after trying google maps and 
    openlayers I realized that I needed a very basic maps API, with only the essential functionalities deployed.
    I've used it at several web pages where maps are needed but without compromising performance and data storage.
    I know it has it flaws versus OpenLayers but it does extremly well what it does.

    So, What do we need to make an API like OpenLayers?, well we need to calculate the 
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


Acknowledgements:
-------------
    Special thanks to Klokan Petr Pridal.
    for the software that converts a raster into TMS tiles, and creates KML SuperOverlay EPSG:4326
    in the GDAL2Tiles project from the Google Summer of Code 2007 & 2008. klokan at klokan dot cz

    Also thanks to Charlie Andrews.
    For the SpryMap widget that makes scrollable divs.


License:
-------------


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



