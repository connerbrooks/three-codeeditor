;(function(exports) {

  var AceMouseEvent = ace.require("ace/mouse/mouse_event").MouseEvent;
  var aceEventLib = ace.require("ace/lib/event");

  exports.addMouseEventListener = addMouseEventListener;


  function addMouseEventListener(THREExDOMEvents, codeEditor) {
    var clickState = {lastClickTime: 0, doubleClickTriggerTime: 500};
    patchTHREExDOMEventInstance(THREExDOMEvents);
    THREExDOMEvents.addEventListener(
      codeEditor, 'mousedown', onMouseEvent3D.bind(null, THREExDOMEvents, codeEditor, clickState), false);
    THREExDOMEvents.addEventListener(
      codeEditor, 'mousemove', onMouseEvent3D.bind(null, THREExDOMEvents, codeEditor, clickState), false);
  }

  function patchTHREExDOMEventInstance(domEvents) {
    domEvents.pickObjFromDOMEvent = function(evt, objsToPick) {
      var mouseCoords = this._getRelativeMouseXY(evt),
        	vector	    = new THREE.Vector3(mouseCoords.x, mouseCoords.y, 0.5),
        	ray         = this._projector.pickingRay(vector, this._camera),
        	intersects  = ray.intersectObjects(objsToPick);
    	return intersects[0];
    }
    // see https://github.com/mrdoob/three.js/issues/5587
    domEvents._projector.pickingRay = function( coords, camera ) {
      var raycaster = new THREE.Raycaster();
      // the camera is assumed _not_ to be a child of a transformed object
      if ( camera instanceof THREE.PerspectiveCamera ) {
          raycaster.ray.origin.copy( camera.position );
          raycaster.ray.direction.set( coords.x, coords.y, 0.5 ).unproject( camera ).sub( camera.position ).normalize();
      } else if ( camera instanceof THREE.OrthographicCamera ) {
          raycaster.ray.origin.set( coords.x, coords.y, - 1 ).unproject( camera );
          raycaster.ray.direction.set( 0, 0, - 1 ).transformDirection( camera.matrixWorld );
      } else {
          console.error( 'ERROR: undefinedzunknown camera type.' );
      }
      return raycaster;
    }
  }

  // THREExDOMEvents.removeEventListener(plane.get(0), 'mousedown', onMouseDown, false)
  function onMouseEvent3D(THREExDOMEvents, codeEditor, clickState, evt) {
    // if (renderState.threeState.orbitControl.enabled) return;
    // tQueryWorld.show(evt.intersect.point);
    window.LastEvent = evt;
  
    // FIXME -- make sure that evt.intersect.object really is editor!
    var aceCoords = codeeditorAceCoordsFromIntersection(evt.intersect, codeEditor.aceEditor);
    reemit3DMouseEvent(THREExDOMEvents, evt.origDomEvent, clickState, codeEditor, aceCoords);
  }

  function reemit3DMouseEvent(THREExDOMEvents, evt, clickState, codeEditor, globalPosForRealEditor) {
    // evt is a DOM event emitted when clicked on the 3D canvas. We patch it up
    // (for coords, target element, etc) and feed this to ace so that the normal ace
    // mouse handlers are invoked.
    // codeEditor is the 3D editor mesh object
  
    var aceEd      = codeEditor.aceEditor,
        type       = evt.type.replace(/^pointer/, "mouse").toLowerCase(),
        fakeEvt    = patchEvent(evt, globalPosForRealEditor, aceEd);
  
    patchAceEventMethods(THREExDOMEvents, aceEd, codeEditor);
  
    if (type === 'mousedown') {
      if (Date.now()-clickState.lastClickTime <= clickState.doubleClickTriggerTime) {
        aceEd._emit("dblclick", new AceMouseEvent(fakeEvt, aceEd));
      }
      clickState.lastClickTime = Date.now();
    }
  
    if (type === 'mousedown') aceEd.$mouseHandler.onMouseEvent("mousedown", fakeEvt)
    else if (type === 'mousemove') aceEd.$mouseHandler.onMouseMove('mousemove', fakeEvt);
    else aceEd._emit(type, new AceMouseEvent(fakeEvt, aceEd));
  
    // Is this really necessary?
    if (type === "mousedown") {
        if (!aceEd.isFocused() && aceEd.textInput)
            aceEd.textInput.moveToMouse(new AceMouseEvent(evt, aceEd));
        aceEd.focus();
    }
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // event conversion
  // -=-=-=-=-=-=-=-=-=-

  function patchAceEventMethods(THREExDOMEvents, aceEd, codeEditor) {
    // ace internally installs new event handler when the mosue is clicked, which
    // e.g. track mouse moves and such. The events coming in are emitted from the 3D
    // environment and actually don't target the ace editor. We install patch
    // functions that will adapt the events so that they make sense for ace
  
    var chain = lively.lang.chain;
  
    // we patch methods so that we can install method patchers... uuuuha
    aceEd.$mouseHandler.captureMouse = chain(aceEd.$mouseHandler.captureMouse)
      .getOriginal().wrap(function(proceed, evt, mouseMoveHandler) {
        evt.domEvent = patchEvent(evt.domEvent,
          codeeditorAceCoordsFromDOMEventOnThreeScene(THREExDOMEvents, evt.domEvent, aceEd, codeEditor),
          aceEd);
  
        mouseMoveHandler = mouseMoveHandler && chain(mouseMoveHandler)
          .getOriginal()
          .wrap(function(proceed, evt) {
            return evt && proceed(
              patchEvent(evt,
                codeeditorAceCoordsFromDOMEventOnThreeScene(THREExDOMEvents, evt, aceEd, codeEditor),
                aceEd));
          }).value();
        return proceed(evt, mouseMoveHandler);
      }).value();
  
    aceEventLib.capture = chain(aceEventLib.capture)
      .getOriginal().wrap(function(proceed, el, eventHandler, releaseCaptureHandler) {
        if (aceEd.container !== el) return proceed(el, eventHandler, releaseCaptureHandler);
        eventHandler = chain(eventHandler)
          .getOriginal()
          .wrap(function(proceed, evt) {
            return evt && proceed(
              patchEvent(evt,
                codeeditorAceCoordsFromDOMEventOnThreeScene(THREExDOMEvents, evt, aceEd, codeEditor),
                aceEd));
          }).value();
  
        releaseCaptureHandler = chain(releaseCaptureHandler)
          .getOriginal()
          .wrap(function(proceed, evt) {
            return evt && proceed(
              patchEvent(evt,
                codeeditorAceCoordsFromDOMEventOnThreeScene(THREExDOMEvents, evt, aceEd, codeEditor),
                aceEd));
          }).value();
  
        return proceed(el, eventHandler, releaseCaptureHandler);
      }).value();
  }
  
  function patchEvent(evt, globalPosForRealEditor, aceEd) {
    globalPosForRealEditor = globalPosForRealEditor || {x:0, y:0};
    if (evt.hasCodeEditor3DPatch) return evt;
  
    var x = globalPosForRealEditor.x,
        y = globalPosForRealEditor.y,
        fakeEvt = Object.create(evt)
    Object.defineProperty(fakeEvt, "pageX",                {value: x});
    Object.defineProperty(fakeEvt, "pageY",                {value: y});
    Object.defineProperty(fakeEvt, "clientX",              {value: x});
    Object.defineProperty(fakeEvt, "clientY",              {value: y});
    Object.defineProperty(fakeEvt, "x",                    {value: x});
    Object.defineProperty(fakeEvt, "y",                    {value: y});
    Object.defineProperty(fakeEvt, "layerX",               {value: x});
    Object.defineProperty(fakeEvt, "layerY",               {value: y});
    Object.defineProperty(fakeEvt, "target",               {value: aceEd.renderer.content});
    Object.defineProperty(fakeEvt, "srcElement",           {value: aceEd.renderer.content});
    Object.defineProperty(fakeEvt, "hasCodeEditor3DPatch", {value: true});
    Object.defineProperty(fakeEvt, "preventDefault",       {value: function() { evt.preventDefault(); }});
    return fakeEvt;
  }


  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // mapping of scene positions
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-

  function codeeditorAceCoordsFromDOMEventOnThreeScene(THREExDOMEvents, evt, aceEd, codeEditor) {
    var intersection = THREExDOMEvents.pickObjFromDOMEvent(evt, [codeEditor], THREExDOMEvents._camera);
    return codeeditorAceCoordsFromIntersection(intersection, aceEd);
  }
  
  function codeeditorAceCoordsFromIntersection(intersection, aceEd) {
    if (!intersection) return null;
    var localCoords = convertToLocalBrowserCoords(intersection.point, intersection.object);
    var aceCoords = {
      x: aceEd.container.offsetLeft + localCoords.x,
      y: aceEd.container.offsetTop + localCoords.y
    }
    return aceCoords;
  }
  
  function convertToLocalBrowserCoords(worldPoint, object) {
    object.geometry.computeBoundingBox()
    var size                = object.geometry.boundingBox.size(),
        worldCenter         = object.position.clone().add(object.geometry.boundingBox.center()),
        localTopLeft        = object.worldToLocal(worldCenter).add(size.multiply(new THREE.Vector3(.5,-.5,.5))),
        localEvt            = object.worldToLocal(worldPoint.clone()),
        browserLocalTopLeft = localTopLeft.clone().add(localEvt).multiply(new THREE.Vector3(1,-1,1))
    return browserLocalTopLeft;
  }

})(THREE.CodeEditor.mouseevents || (THREE.CodeEditor.mouseevents = {}));