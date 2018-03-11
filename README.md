# homebridge-neo-pixel-platform
A plugin for Homebridge to be able to define and control multiple lights on a single NeoPixel strand of LED's

This plugin uses the [rpi-ws281x-native](https://www.npmjs.com/package/rpi-ws281x-native) plugin that requires HW access and with that access privileges as it uses the [rpi_ws281x](https://github.com/jgarff/rpi_ws281x) library in its turn. The standard way of connecting is assumed. No options are forwarded to the plugin.

Please refer to the [rpi_ws281x](https://github.com/jgarff/rpi_ws281x) page for hardware instructions.

# Install
Standard install through npm when published on NPM... Note the sudo and the -g additions to standard npm install.
```console
$ sudo npm install -g homebridge-neo-pixel-platform
```
Homebridge itself should run with priviliged access. I use homebridge in systemd running with sudo rights.

# Configure
Configuration is relatively straightforward. Below is a json platform snippet to add to your Homebridge configuration. Adding lights is done through a websevice.

```json
"platforms": [{
    "platform": "NeoPixels.MultiLightPlatform",
    "servicePort": 6615,
    "name": "NeoPixels",
    "nrOfLeds": 14
}]
```
The servicePort parameter is there to select a free port on your system. The webservice won't win a beauty contest but it works.

## Add lights
Following commands add three lights, one using all (14) LED's, one at the beginning and one at the end of the string:
```console
curl -H "Content-Type: application/json" -X POST -d '{"name":"All","startIdx":"0","endIdx":"14"}' http://<homebridgeIp>:<servicePort>/add
curl -H "Content-Type: application/json" -X POST -d '{"name":"Start LEDs","startIdx":"0","endIdx":"4"}' http://<homebridgeIp>:<servicePort>/add
curl -H "Content-Type: application/json" -X POST -d '{"name":"End LEDs","startIdx":"11","endIdx":"14"}' http://<homebridgeIp>:<servicePort>/add
```

## Remove lights
Removing them is similar:
```console
curl http://<homebridgeIp>:<servicePort>/remove?All
curl http://<homebridgeIp>:<servicePort>/remove?Start%20LEDs
curl http://<homebridgeIp>:<servicePort>/remove?End%20LEDs
```
