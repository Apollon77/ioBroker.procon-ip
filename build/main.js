"use strict";
/*
 * Created with @iobroker/create-adapter v1.15.1
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProconIp = void 0;
// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const procon_ip_1 = require("procon-ip");
const crypto_helper_1 = require("./lib/crypto-helper");
class ProconIp extends utils.Adapter {
    constructor(options = {}) {
        super(Object.assign(Object.assign({}, options), { name: "procon-ip" }));
        this._bootstrapped = false;
        this._objectStateFields = [
            "value",
            "category",
            "label",
            "unit",
            "displayValue",
            "active",
        ];
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this._forceUpdate = new Array();
        this._stateData = new procon_ip_1.GetStateData();
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    onReady() {
        return __awaiter(this, void 0, void 0, function* () {
            let connectionApproved = false;
            this.setState("info.connection", false, true);
            this.getForeignObject("system.config", (err, obj) => {
                let encryptedNative = [];
                if (this.ioPack && this.ioPack.encryptedNative) {
                    encryptedNative = encryptedNative.concat(this.ioPack.encryptedNative);
                }
                for (const setting in this.config) {
                    if (this.config[setting].length > 0 && encryptedNative.indexOf(setting) >= 0 &&
                        (!this.supportsFeature || !this.supportsFeature("ADAPTER_AUTO_DECRYPT_NATIVE"))) {
                        //noinspection JSUnresolvedVariable
                        if (typeof obj !== "undefined" && obj.native && obj.native.secret) {
                            //noinspection JSUnresolvedVariable
                            this.config[setting] = crypto_helper_1.CryptoHelper.decrypt(this.config[setting], obj.native.secret);
                        }
                        else {
                            //noinspection JSUnresolvedVariable
                            this.log.warn("Cannot get native secret for encryption. Falling back to hard coded default key!");
                            this.config[setting] = crypto_helper_1.CryptoHelper.decrypt(this.config[setting], "1234567890abcdef1234567890abcdef1234567890abcdef");
                        }
                    }
                }
                // The adapters config (in the instance object everything under the attribute "native") is accessible via
                // this.config:
                if (this.config["controllerUrl"].length < 1 || !ProconIp.isValidURL(this.config["controllerUrl"])) {
                    this.log.warn(`Invalid controller URL ('${this.config["controllerUrl"]}') supplied.`);
                    return 0;
                }
                const serviceConfig = Object.defineProperties(Object.create(this.config), {
                    baseUrl: {
                        value: this.config.controllerUrl,
                        writable: true,
                    },
                    timeout: {
                        value: this.config.requestTimeout,
                        writable: true,
                    },
                });
                this._relayDataInterpreter = new procon_ip_1.RelayDataInterpreter(this.log);
                this._getStateService = new procon_ip_1.GetStateService(serviceConfig, this.log);
                this._usrcfgCgiService = new procon_ip_1.UsrcfgCgiService(serviceConfig, this.log, this._getStateService, this._relayDataInterpreter);
                this.log.debug(`GetStateService url: ${this._getStateService.url}`);
                this.log.debug(`UsrcfgCgiService url: ${this._usrcfgCgiService.url}`);
                this._getStateService.update().then(data => {
                    this._stateData = data;
                    // Set objects once
                    if (!this._bootstrapped) {
                        this.log.debug(`Initially setting adapter objects`);
                        this.setSysInfo(data.sysInfo);
                        this.setObjects(data.objects);
                    }
                });
                setTimeout(() => {
                    // Start the actual service
                    this._getStateService.start((data) => {
                        this.log.silly(`Start processing new GetState.csv`);
                        connectionApproved = true;
                        // Set sys info states
                        data.sysInfo.toArrayOfObjects().forEach((info) => {
                            // Only update when value has changed
                            if (!this._bootstrapped || info.value !== this._stateData.sysInfo[info.key]) {
                                this.log.debug(`Updating sys info state ${info.key}: ${info.value}`);
                                this.setStateAsync(`${this.name}.${this.instance}.info.system.${info.key}`, info.value.toString(), true).catch((e) => {
                                    this.log.error(`Failed setting state for '${info.key}': ${e}`);
                                });
                            }
                        });
                        this.updateAdvancedSysInfoStates(data.sysInfo);
                        // Set actual sensor and actor/relay object states
                        data.objects.forEach((obj) => {
                            this.log.silly(`Comparing previous and current value (${obj.displayValue}) for '${obj.label}' (${obj.category})`);
                            this.log.silly(`this._stateData.getDataObject(obj.id).value: ${this._stateData.getDataObject(obj.id).value}`);
                            this.log.silly(`obj.value: ${obj.value}`);
                            // Only update when value has changed or update is forced (on state change)
                            const forceObjStateUpdate = this._forceUpdate.indexOf(obj.id);
                            if (!this._bootstrapped || forceObjStateUpdate >= 0 || (this._stateData.getDataObject(obj.id) &&
                                this._stateData.getDataObject(obj.id).value != obj.value)) {
                                if (this._stateData.getDataObject(obj.id).label != obj.label) {
                                    this.log.debug(`Updating label for '${obj.label}' (${obj.category})`);
                                    this.updateObjectCommonName(obj);
                                }
                                this.log.debug(`Updating value for '${obj.label}' (${obj.category})`);
                                this.setDataState(obj);
                                if (this._forceUpdate[forceObjStateUpdate]) {
                                    delete this._forceUpdate[forceObjStateUpdate];
                                }
                            }
                        });
                        this.log.silly(`Updating data object for next comparison`);
                        this._stateData = data;
                        this._bootstrapped = true;
                        this.setState("info.connection", true, true);
                    }, (e) => {
                        var _a;
                        this.setState("info.connection", false, true);
                        if (!connectionApproved) {
                            this.log.error(`Could not connect to the controller: ${(e === null || e === void 0 ? void 0 : e.message) ? e.message : e}`);
                            (_a = this._getStateService) === null || _a === void 0 ? void 0 : _a.stop();
                        }
                    });
                }, 3000);
                this.subscribeStates(`${this.name}.${this.instance}.relays.*`);
                this.subscribeStates(`${this.name}.${this.instance}.externalRelays.*`);
            });
        });
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload(callback) {
        var _a;
        try {
            // Stop the service loop (this also handles the info.connection state)
            (_a = this._getStateService) === null || _a === void 0 ? void 0 : _a.stop();
            this.setState("info.connection", false, true);
        }
        catch (e) {
            this.log.error(`Failed to stop GetState service: ${e}`);
        }
        finally {
            callback();
        }
    }
    /**
     * Is called if a subscribed object changes
     */
    // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }
    /**
     * Is called if a subscribed state changes
     */
    onStateChange(id, state) {
        if (!state) {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
            return;
        }
        if (state.ack) {
            // The state is already acknowledged -> no need to change anything
            return;
        }
        if (id.endsWith(".auto")) {
            this.relayToggleAuto(id, state).catch((e) => {
                this.log.error(`Error on relay toggle (${id}): ${e}`);
            });
        }
        else if (id.endsWith(".onOff")) {
            this.relayToggleOnOff(id, state).catch((e) => {
                this.log.error(`Error on relay toggle (${id}): ${e}`);
            });
        }
    }
    relayToggleAuto(objectId, state) {
        return __awaiter(this, void 0, void 0, function* () {
            const onOffState = yield this.getStateAsync(objectId.replace(/\.auto$/, ".onOff"));
            if (!onOffState) {
                throw new Error(`Cannot get onOff state to toggle '${objectId}'`);
            }
            const obj = yield this.getObjectAsync(objectId);
            if (!obj) {
                throw new Error(`Cannot handle state change for non-existent object '${objectId}'`);
            }
            const getStateDataObject = this._stateData.getDataObject(obj.native.id);
            this._forceUpdate.push(getStateDataObject.id);
            try {
                if (!!state.val) {
                    this.log.info(`Switching ${obj.native.label}: auto`);
                    return this._usrcfgCgiService.setAuto(getStateDataObject);
                }
                else if (!!onOffState.val) {
                    this.log.info(`Switching ${obj.native.label}: on`);
                    return this._usrcfgCgiService.setOn(getStateDataObject);
                }
                else {
                    this.log.info(`Switching ${obj.native.label}: off`);
                    return this._usrcfgCgiService.setOff(getStateDataObject);
                }
            }
            catch (e) {
                throw new Error(`Error on switching operation: ${e}`);
            }
        });
    }
    relayToggleOnOff(objectId, state) {
        return __awaiter(this, void 0, void 0, function* () {
            const obj = yield this.getObjectAsync(objectId);
            if (!obj) {
                throw new Error(`Cannot handle state change for non-existent object '${objectId}'`);
            }
            const getStateDataObject = this._stateData.getDataObject(obj.native.id);
            this._forceUpdate.push(getStateDataObject.id);
            try {
                if (!!state.val) {
                    this.log.info(`Switching ${obj.native.label}: on`);
                    yield this._usrcfgCgiService.setOn(getStateDataObject);
                }
                else {
                    this.log.info(`Switching ${obj.native.label}: off`);
                    yield this._usrcfgCgiService.setOff(getStateDataObject);
                }
            }
            catch (e) {
                this.log.error(e);
            }
        });
    }
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.message" property to be set to true in io-package.json
    //  */
    // private onMessage(obj: ioBroker.Message): void {
    //     if (typeof obj === "object" && obj.message) {
    //         if (obj.command === "send") {
    //             // e.g. send email or pushover or whatever
    //             this.log.info("send command");
    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    //         }
    //     }
    // }
    updateAdvancedSysInfoStates(sysInfo) {
        if (!this._bootstrapped || sysInfo.dosageControl !== this._stateData.sysInfo.dosageControl) {
            this.log.debug('Updating advanced sys info states');
            this.setStateAsync(`${this.name}.${this.instance}.info.system.phPlusDosageEnabled`, sysInfo.isPhPlusDosageEnabled(), true).catch((e) => {
                this.log.error(`Failed setting state for '${this.name}.${this.instance}.info.system.phPlusDosageEnabled': ${e}`);
            });
            this.setStateAsync(`${this.name}.${this.instance}.info.system.phMinusDosageEnabled`, sysInfo.isPhMinusDosageEnabled(), true).catch((e) => {
                this.log.error(`Failed setting state for '${this.name}.${this.instance}.info.system.phMinusDosageEnabled': ${e}`);
            });
            this.setStateAsync(`${this.name}.${this.instance}.info.system.chlorineDosageEnabled`, sysInfo.isChlorineDosageEnabled(), true).catch((e) => {
                this.log.error(`Failed setting state for '${this.name}.${this.instance}.info.system.chlorineDosageEnabled': ${e}`);
            });
            this.setStateAsync(`${this.name}.${this.instance}.info.system.electrolysis`, sysInfo.isElectrolysis(), true).catch((e) => {
                this.log.error(`Failed setting state for '${this.name}.${this.instance}.info.electrolysis': ${e}`);
            });
        }
    }
    /**
     * Set/update system information
     */
    setSysInfo(data) {
        this.setObjectNotExists(`${this.name}.${this.instance}.info.system`, {
            type: "channel",
            common: {
                name: "SysInfo"
            },
            native: {}
        });
        data.toArrayOfObjects().forEach((sysInfo) => {
            this.setObjectNotExists(`${this.name}.${this.instance}.info.system.${sysInfo.key}`, {
                type: "state",
                common: {
                    name: sysInfo.key,
                    type: "string",
                    role: "state",
                    read: true,
                    write: false
                },
                native: {},
            });
            // this.setObjectNotExistsAsync(`${this.name}.${this.instance}.info.system.${sysInfo.key}`, {
            //     type: "state",
            //     common: {
            //         name: sysInfo.key,
            //         type: "string",
            //         role: "state",
            //         read: true,
            //         write: false
            //     },
            //     native: {},
            // }).then(() => {
            //     this.log.info(`Sys info object '${sysInfo.key}' has been set`);
            // }).catch((e) => {
            //     this.log.error(`Failed setting sysInfo object '${sysInfo.key}': ${e}`);
            // });
        });
        this.setObjectNotExists(`${this.name}.${this.instance}.info.system.phPlusDosageEnabled`, {
            type: "state",
            common: {
                name: "pH+ enabled",
                type: "boolean",
                role: "state",
                read: true,
                write: false
            },
            native: {},
        });
        this.setObjectNotExists(`${this.name}.${this.instance}.info.system.phMinusDosageEnabled`, {
            type: "state",
            common: {
                name: "pH- enabled",
                type: "boolean",
                role: "state",
                read: true,
                write: false
            },
            native: {},
        });
        this.setObjectNotExists(`${this.name}.${this.instance}.info.system.chlorineDosageEnabled`, {
            type: "state",
            common: {
                name: "CL enabled",
                type: "boolean",
                role: "state",
                read: true,
                write: false
            },
            native: {},
        });
        this.setObjectNotExists(`${this.name}.${this.instance}.info.system.electrolysis`, {
            type: "state",
            common: {
                name: "Electrolysis",
                type: "boolean",
                role: "state",
                read: true,
                write: false
            },
            native: {},
        });
    }
    /**
     * Set/update objects (not their states!)
     * @param data
     */
    setObjects(objects) {
        let lastObjCategory = "";
        objects.forEach((obj) => {
            if (lastObjCategory !== obj.category) {
                // Define each api object category as device
                this.setObjectNotExists(`${this.name}.${this.instance}.${obj.category}`, {
                    type: "channel",
                    common: {
                        name: obj.category,
                    },
                    native: {}
                });
                lastObjCategory = obj.category;
            }
            this.setDataObject(obj).catch((e) => {
                this.log.error(`Failed setting objects for '${obj.label}': ${e}`);
            });
        });
    }
    setDataObject(obj) {
        return __awaiter(this, void 0, void 0, function* () {
            this.setObjectNotExists(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}`, {
                type: "channel",
                common: {
                    name: obj.label,
                },
                native: {},
            });
            for (const field of Object.keys(obj)) {
                const common = {
                    name: obj.label,
                    type: typeof obj[field],
                    role: "value",
                    read: true,
                    write: false
                };
                switch (field) {
                    case "value":
                        if (obj.category == procon_ip_1.GetStateCategory.TEMPERATURES) {
                            common.role = "value.temperature";
                            common.unit = `°${obj.unit}`;
                            if (obj.active) {
                                common.smartName = {
                                    de: obj.label,
                                    en: obj.label,
                                    smartType: "THERMOSTAT"
                                };
                            }
                        }
                        break;
                    case "category":
                    case "label":
                    case "unit":
                    case "displayValue":
                        common.role = "text";
                        break;
                    case "active":
                        common.role = "indicator";
                        break;
                    default:
                        continue;
                }
                try {
                    this.setObjectNotExists(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.${field}`, {
                        type: "state",
                        common: common,
                        native: obj,
                    });
                }
                catch (e) {
                    this.log.error(`Failed setting object '${obj.label}': ${e}`);
                }
            }
            if (obj.category === procon_ip_1.GetStateCategory.RELAYS || (obj.category === procon_ip_1.GetStateCategory.EXTERNAL_RELAYS &&
                this._stateData.sysInfo.isExtRelaysEnabled())) {
                this.setRelayDataObject(obj);
            }
        });
    }
    setRelayDataObject(obj) {
        const isLight = new RegExp("light|bulb|licht|leucht", "i").test(obj.label);
        const commonAuto = {
            name: obj.label,
            type: "boolean",
            role: "switch.mode.auto",
            read: true,
            write: true,
            smartName: obj.active ? {
                de: `${obj.label} auto`,
                en: `${obj.label} auto`,
                smartType: isLight ? "LIGHT" : "SWITCH"
            } : {}
        };
        const commonOnOff = {
            name: obj.label,
            type: "boolean",
            role: isLight ? "switch.light" : "switch",
            read: true,
            //write: !this._getStateService.data.isDosageControl(obj.id),
            write: true,
            //smartName: obj.active && !this._getStateService.data.isDosageControl(obj.id) ? {
            smartName: obj.active ? {
                de: obj.label,
                en: obj.label,
                smartType: isLight ? "LIGHT" : "SWITCH"
            } : {}
        };
        this.setObjectNotExists(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.auto`, {
            type: "state",
            common: commonAuto,
            native: obj,
        });
        this.setObjectNotExists(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.onOff`, {
            type: "state",
            common: commonOnOff,
            native: obj,
        });
        // this.setObjectNotExistsAsync(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.auto`, {
        //     type: "state",
        //     common: commonAuto,
        //     native: obj,
        // }).then(() => {
        //     this.log.info(`set auto/manual switch for '${obj.label}'`);
        // }).catch((e) => {
        //     this.log.error(`Failed setting auto/manual switch for '${obj.label}': ${e}`);
        // });
        // this.setObjectNotExistsAsync(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.onOff`, {
        //     type: "state",
        //     common: commonOnOff,
        //     native: obj,
        // }).then(() => {
        //     this.log.info(`set onOff switch for '${obj.label}'`);
        // }).catch((e) => {
        //     this.log.error(`Failed setting onOff switch for '${obj.label}': ${e}`);
        // });
    }
    setDataState(obj) {
        for (const field of Object.keys(obj).filter(field => this._objectStateFields.indexOf(field) > -1)) {
            this.setStateAsync(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.${field}`, obj[field], true).catch((e) => {
                this.log.error(`Failed setting state for '${obj.label}': ${e}`);
            });
        }
        if (obj.category === procon_ip_1.GetStateCategory.RELAYS || (obj.category === procon_ip_1.GetStateCategory.EXTERNAL_RELAYS &&
            this._stateData.sysInfo.isExtRelaysEnabled())) {
            this.setRelayDataState(obj);
        }
    }
    setRelayDataState(obj) {
        this.setStateAsync(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.auto`, this._relayDataInterpreter.isAuto(obj), true).catch((e) => {
            this.log.error(`Failed setting auto/manual switch state for '${obj.label}': ${e}`);
        });
        this.setStateAsync(`${this.name}.${this.instance}.${obj.category}.${obj.categoryId}.onOff`, this._relayDataInterpreter.isOn(obj), true).catch((e) => {
            this.log.error(`Failed setting onOff switch state for '${obj.label}': ${e}`);
        });
    }
    updateObjectCommonName(obj) {
        const objId = `${this.name}.${this.instance}.${obj.category}.${obj.categoryId}`;
        this.getObjectAsync(objId).then((ioObj) => {
            if (ioObj) {
                ioObj.common.name = obj.label;
                this.setObject(objId, ioObj);
            }
        });
        this.getStatesOfAsync(objId).then((objStates) => {
            objStates.forEach((state) => {
                state.common.name = obj.label;
                this.setObject(state._id, state);
            });
        });
    }
    static isValidURL(url) {
        try {
            new URL(url);
            return true;
        }
        catch (e) {
            return false;
        }
    }
}
exports.ProconIp = ProconIp;
if (module.parent) {
    // Export the constructor in compact mode
    module.exports = (options) => new ProconIp(options);
}
else {
    // otherwise start the instance directly
    (() => new ProconIp())();
}
