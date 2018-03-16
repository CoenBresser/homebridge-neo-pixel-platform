var http = require('http');
var events = require('events');
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
  log(packageJson.platformName + " Init. Version: " + packageJson.version);
  var platform = this;
  this.log = log;
  this.config = config;
  this.accessories = {};
  this.accessoryStates = {};
  this.eventEmitter = new events.EventEmitter();
  this.eventEmitter.addListener('change', platform.writeAccessoryStates);

  platform.ws281x = require('rpi-ws281x-native');
  platform.ws281x.init(config.nrOfLeds);

  resetPixelData = new Uint32Array(config.nrOfLeds);
  resetPixelData.fill(0);
  platform.ws281x.render(resetPixelData);

  //TODO: change to be able to win a beauty contest.
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

  // TODO: Check port range, go to default if null or out of range
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

      if (config.showRainbowAnimationWhenStarted) {
        function colorwheel(pos) {
          pos = 255 - pos;
          if (pos < 85) { return rgb2Int(255 - pos * 3, 0, pos * 3); }
          else if (pos < 170) { pos -= 85; return rgb2Int(0, pos * 3, 255 - pos * 3); }
          else { pos -= 170; return rgb2Int(pos * 3, 255 - pos * 3, 0); }
        }

        function rgb2Int(r, g, b) {
          return ((r & 0xff) << 16) + ((g & 0xff) << 8) + (b & 0xff);
        }

        var count = 0;
        var colorStep = 256 / 32;
        pixelData = new Uint32Array(platform.config.nrOfLeds);
        pixelData.fill(0);
        // Create an interval object to show a rainbow runner when started
        var intervalObj = setInterval(function () {
          // Shift in 32 rainbow colors, run over string, and shift out
          if (count >= 2 * 32 + config.nrOfLeds) {
            clearInterval(intervalObj);
          } else {
            count = count + 1;
          }

          for (var i = config.nrOfLeds - 1; i >= 1; i--) {
            pixelData[i] = pixelData[i-1];
          }
          if (count <= 32) {
            pixelData[0] = colorwheel(count * colorStep - 1);
          } else {
            pixelData[0] = 0;
          }

          platform.ws281x.render(pixelData);
        }, 4000 / (2 * 32 + config.nrOfLeds));
      }

    }.bind(this));
  }
}

// Function invoked when homebridge tries to restore cached accessory.
// Developer can configure accessory at here (like setup event handler).
// Update current value.
MultiLightPlatform.prototype.configureAccessory = function(accessory) {
  this.log(accessory.displayName, "Configure Accessory");
  var platform = this;
  accessory.reachable = true;

  accessory.on('identify', function(paired, callback) {
    platform.log(accessory.displayName, "Identify!!!");
    callback();
  });

  // Config the accessary and create a state object
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
      platform.eventEmitter.emit('change', platform);
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].swi);
    });

    accessoryServices.getCharacteristic(Characteristic.Brightness)
    .on('set', function(value, callback) {
      platform.accessoryStates[accessory.displayName].bri = value;
      platform.eventEmitter.emit('change', platform);
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].bri);
    });

    accessoryServices.getCharacteristic(Characteristic.Hue)
    .on('set', function(value, callback) {
      platform.accessoryStates[accessory.displayName].hue = value;
      platform.eventEmitter.emit('change', platform);
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].hue);
    });

    accessoryServices.getCharacteristic(Characteristic.Saturation)
    .on('set', function(value, callback) {
      platform.accessoryStates[accessory.displayName].sat = value;
      platform.eventEmitter.emit('change', platform);
      callback();
    }).on('get', function(callback) {
      callback(null, platform.accessoryStates[accessory.displayName].sat);
    });
  }

  this.accessories[accessory.displayName] = accessory;
}

MultiLightPlatform.prototype.writeAccessoryStates = function(platform) {

  // Start fresh
  pixelData = new Uint32Array(platform.config.nrOfLeds);
  pixelData.fill(0);
  for (const accName in platform.accessoryStates) {
    accState = platform.accessoryStates[accName];
    acc = platform.accessories[accName];

    if (accState.swi) {
      var rgb = convert.hsv.rgb(accState.hue, accState.sat, accState.bri);
      rgbUINT32 = (rgb[0] * 256 + rgb[1]) * 256 + rgb[2];

      // Combine the data
      for (i = acc.context.startIdx; i < acc.context.endIdx; i++) {
        var pd = pixelData[i];
        currentB = pd % 256;
        pd = pd / 256;
        currentG = pd % 256;
        currentR = pd / 256 % 256; // just to be sure when random data is shifted in.

        newR = Math.min(255, currentR + rgb[0]);
        newG = Math.min(255, currentG + rgb[1]);
        newB = Math.min(255, currentB + rgb[2]);

        pixelData[i] = (newR * 256 + newG) * 256 + newB;
      }
    }
  }
  platform.ws281x.render(pixelData);
}

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
    // Always accessible as they're on this HW platform
    accessory.updateReachability(true);
  }
}

MultiLightPlatform.prototype.removeAccessory = function(accName) {
  this.log("Remove Accessory", accName);
  if (this.accessories[accName]) {
    this.api.unregisterPlatformAccessories(packageJson.pluginName, packageJson.platformName, [this.accessories[accName]]);
    delete this.accessories[accName];
    delete this.accessoryStates[accName];
  }
}
