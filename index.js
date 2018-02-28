var http = require('http');
var convert = require('color-convert');
var packageJson = require('./package.json');
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  console.log("homebridge API version: " + homebridge.version);

  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;

  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform(packageJson.pluginName, packageJson.platformName, MultiLightPlatform, true);
}

// Platform constructor
// config may be null
// api may be null if launched from old homebridge version
function MultiLightPlatform(log, config, api) {
  log(packageJson.platformName + " Init");
  var platform = this;
  this.log = log;
  this.config = config;
  this.accessories = {};
  this.accessoryStates = {};

  //platform.log(config);

  platform.ws281x = require('rpi-ws281x-native');
  platform.pixelData = new Uint32Array(config.nrOfLeds);
  platform.ws281x.init(config.nrOfLeds);
  platform.ws281x.reset();

    // http.createServer((request, response) => {
    //   const { headers, method, url } = request;
    //   platform.log(headers);
    //   platform.log(method);
    //   platform.log(url);
    //
    //   let body = [];
    //   request.on('error', (err) => {
    //     console.error(err);
    //   }).on('data', (chunk) => {
    //     body.push(chunk);
    //   }).on('end', () => {
    //     body = Buffer.concat(body).toString();
    //     // At this point, we have the headers, method, url and body, and can now
    //     // do whatever we need to in order to respond to this request.
    //     platform.log(body);
    //   });
    // }).listen(28082); // Activates this server, listening on port 8080.

  //TODO: improve this server massively in another module/file
  this.requestServer = http.createServer(function(request, response) {
    const { headers, method, url } = request;
    if (url === "/add" && method === "POST") {
      let body = [];
      request.on('error', (err) => {
        console.error(err);
      }).on('data', (chunk) => {
        body.push(chunk);
      }).on('end', () => {
        body = Buffer.concat(body).toString();
        // At this point, we have the headers, method, url and body, and can now
        // do whatever we need to in order to respond to this request.

        accessoryConfig = JSON.parse(body);

        this.addAccessory(accessoryConfig.name, parseInt(accessoryConfig.startIdx), parseInt(accessoryConfig.endIdx));
        response.writeHead(204);
        response.end();
      });
    }

    if (url == "/reachability") {
      this.updateAccessoriesReachability();
      response.writeHead(204);
      response.end();
    }

    if (url.startsWith("/remove?")) {
      this.removeAccessory(decodeURI(url.substr(8)));
      response.writeHead(204);
      response.end();
    }
  }.bind(this));

  this.requestServer.listen(config.servicePort, function() {
    platform.log("Server Listening...");
  });

  if (api) {
      // Save the API object as plugin needs to register new accessory via this object
      this.api = api;

      // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
      // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
      // Or start discover new accessories.
      this.api.on('didFinishLaunching', function() {
        platform.log("DidFinishLaunching");
        // setInterval(function() {
        //   platform.log("Update");
        // }, 5000);
      }.bind(this));
  }
}

// Function invoked when homebridge tries to restore cached accessory.
// Developer can configure accessory at here (like setup event handler).
// Update current value.
MultiLightPlatform.prototype.configureAccessory = function(accessory) {
  this.log(accessory.displayName, "Configure Accessory");
  var platform = this;

  // Set the accessory to reachable if plugin can currently process the accessory,
  // otherwise set to false and update the reachability later by invoking
  // accessory.updateReachability()
  accessory.reachable = true;

  accessory.on('identify', function(paired, callback) {
    platform.log(accessory.displayName, "Identify!!!");
    callback();
  });

  if (accessory.getService(Service.Lightbulb)) {
    this.accessoryStates[accessory.displayName] = {
      "swi": false,
      "hue": 0,
      "sat": 0,
      "bri": 0
    }
    accessoryServices = accessory.getService(Service.Lightbulb)

    accessoryServices.getCharacteristic(Characteristic.On)
    .on('set', function(value, callback) {
      platform.accessoryStates[accessory.displayName].swi = value;
      platform.writeAccessoryStates()
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].swi);
    });

    accessoryServices.getCharacteristic(Characteristic.Brightness)
    .on('set', function(value, callback) {
      platform.accessoryStates[accessory.displayName].bri = value;
      platform.writeAccessoryStates()
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].bri);
    });

    accessoryServices.getCharacteristic(Characteristic.Hue)
    .on('set', function(value, callback) {
      platform.accessoryStates[accessory.displayName].hue = value;
      platform.writeAccessoryStates()
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].hue);
    });

    accessoryServices.getCharacteristic(Characteristic.Saturation)
    .on('set', function(value, callback) {
      platform.accessoryStates[accessory.displayName].sat = value;
      platform.writeAccessoryStates()
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].sat);
    });
  }

  this.accessories[accessory.displayName] = accessory;
}

MultiLightPlatform.prototype.writeAccessoryStates = function() {
  platform = this;

  // Start fresh
  platform.pixelData.fill(0);
  for (const accName in platform.accessoryStates) {
    accState = platform.accessoryStates[accName];
    acc = platform.accessories[accName];

    if (accState.swi) {
      var rgb = convert.hsl.rgb(accState.hue, accState.sat, accState.bri);
      rgbUINT32 = (rgb[0] * 255 + rgb[1]) * 255 + rgb[2];
      platform.log("RGB: ", rgb);

      // Combine the data
      for (i = acc.context.startIdx; i < acc.context.endIdx; i++) {
        var pd = platform.pixelData[i];
        currentB = pd % 255;
        pd = pd / 255;
        currentG = pd % 255;
        currentR = pd / 255 % 255; // just to be sure when 1's are shifted in.

        newR = Math.min(255, currentR + rgb[0]);
        newG = Math.min(255, currentG + rgb[1]);
        newB = Math.min(255, currentB + rgb[2]);

        platform.pixelData[i] = (newR * 255 + newG) * 255 + newB;
      }
    }
  }
  platform.log("Full array: ", platform.pixelData);
}

// Sample function to show how developer can add accessory dynamically from outside event
MultiLightPlatform.prototype.addAccessory = function(accessoryName, startIdx, endIdx) {
  this.log("Add Accessory");
  var platform = this;
  var uuid;

  uuid = UUIDGen.generate(accessoryName + startIdx + endIdx);

  var newAccessory = new Accessory(accessoryName, uuid);
  newAccessory.context.startIdx = startIdx;
  newAccessory.context.endIdx = endIdx;

  newAccessory.addService(Service.Lightbulb, accessoryName);
  this.configureAccessory(newAccessory);
  this.api.registerPlatformAccessories(packageJson.pluginName, packageJson.platformName, [newAccessory]);
}

MultiLightPlatform.prototype.updateAccessoriesReachability = function() {
  this.log("Update Reachability");
  for (const accName in this.accessories) {
    var accessory = this.accessories[accName];
    accessory.updateReachability(false);
  }
}

// Sample function to show how developer can remove accessory dynamically from outside event
MultiLightPlatform.prototype.removeAccessory = function(accName) {
  this.log("Remove Accessory", accName);
  if (this.accessories[accName]) {
    this.api.unregisterPlatformAccessories(packageJson.pluginName, packageJson.platformName, [this.accessories[accName]]);
    delete this.accessories[accName];
  }
}

// Handler will be invoked when user try to config your plugin.
// Callback can be cached and invoke when necessary.
MultiLightPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
  this.log("Context: ", JSON.stringify(context));
  this.log("Request: ", JSON.stringify(request));

  // Check the request response
  if (request && request.response && request.response.inputs && request.response.inputs.name) {
    this.addAccessory(request.response.inputs.name);

    // Invoke callback with config will let homebridge save the new config into config.json
    // Callback = function(response, type, replace, config)
    // set "type" to platform if the plugin is trying to modify platforms section
    // set "replace" to true will let homebridge replace existing config in config.json
    // "config" is the data platform trying to save
    callback(null, "platform", true, {"platform":"MultiLightPlatform", "otherConfig":"SomeData"});
    return;
  }

  // - UI Type: Input
  // Can be used to request input from user
  // User response can be retrieved from request.response.inputs next time
  // when configurationRequestHandler being invoked

  var respDict = {
    "type": "Interface",
    "interface": "input",
    "title": "Add Accessory",
    "items": [
      {
        "id": "name",
        "title": "Name",
        "placeholder": "Fancy Light"
      }//,
      // {
      //   "id": "pw",
      //   "title": "Password",
      //   "secure": true
      // }
    ]
  }

  // - UI Type: List
  // Can be used to ask user to select something from the list
  // User response can be retrieved from request.response.selections next time
  // when configurationRequestHandler being invoked

  // var respDict = {
  //   "type": "Interface",
  //   "interface": "list",
  //   "title": "Select Something",
  //   "allowMultipleSelection": true,
  //   "items": [
  //     "A","B","C"
  //   ]
  // }

  // - UI Type: Instruction
  // Can be used to ask user to do something (other than text input)
  // Hero image is base64 encoded image data. Not really sure the maximum length HomeKit allows.

  // var respDict = {
  //   "type": "Interface",
  //   "interface": "instruction",
  //   "title": "Almost There",
  //   "detail": "Please press the button on the bridge to finish the setup.",
  //   "heroImage": "base64 image data",
  //   "showActivityIndicator": true,
  // "showNextButton": true,
  // "buttonText": "Login in browser",
  // "actionURL": "https://google.com"
  // }

  // Plugin can set context to allow it track setup process
  context.ts = "Hello";

  // Invoke callback to update setup UI
  callback(respDict);
}
