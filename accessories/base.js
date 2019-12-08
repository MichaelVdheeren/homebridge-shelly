const { handleFailedRequest } = require('../error-handlers')

module.exports = homebridge => {
  const Accessory = homebridge.hap.Accessory
  const Characteristic = homebridge.hap.Characteristic
  const PlatformAccessory = homebridge.platformAccessory
  const Service = homebridge.hap.Service
  const uuid = homebridge.hap.uuid

  /**
   * Base class for all accessories.
   */
  class ShellyAccessory {
    /**
     * @param {string} accessoryType - Type identifier of this accessory.
     * @param {Object} device - The device associated with this accessory.
     * @param {number} index - The index of this accessory, in case the device
     * has multiple accessories.
     * @param {Object} config - Configuration options for this accessory.
     * @param {Object} log - The logger to use.
     * @param {Object[]} abilities - The abilities that this accessory should
     * have.
     */
    constructor(accessoryType, device, index, config, log, abilities = null) {
      this.accessoryType = accessoryType
      this.device = device
      this.index = index || 0
      this.config = config || {}
      this.log = log
      this.platformAccessory = null
      this.abilities = abilities || []
    }

    /**
     * The name of this accessory, as specified by either the configuration,
     * the device's name or `defaultName`.
     */
    get name() {
      if (this.config.name) {
        return this.config.name
      } else if (this.device.name) {
        return `${this.device.name} #${this.index}`
      }
      return this.defaultName
    }

    /**
     * The default name of this accessory.
     */
    get defaultName() {
      const d = this.device
      return `${d.type} ${d.id} ${this.index}`
    }

    /**
     * The HomeKit category of this accessory.
     */
    get category() {
      // subclasses should override this
      return Accessory.Categories.OTHER
    }

    /**
     * Sets up this accessory and all of its abilities.
     * @param {Object} platformAccessory - A homebridge platform accessory to
     * associate with this accessory. Omit this parameter to create a new
     * platform accessory.
     */
    setup(platformAccessory = null) {
      let setupPlatformAccessory = false

      if (!platformAccessory) {
        this.platformAccessory = this._createPlatformAccessory()
        setupPlatformAccessory = true
      } else {
        this.platformAccessory = platformAccessory
      }

      this._setupEventHandlers()
      this.updateAccessoryInformation()

      for (const a of this.abilities) {
        a.setup(this, setupPlatformAccessory)
      }
    }

    _createPlatformAccessory() {
      const d = this.device
      const pa = new PlatformAccessory(
        this.name,
        uuid.generate(this.name)
      )

      pa.category = this.category

      // set some info about this accessory
      pa.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, 'Shelly')
        .setCharacteristic(Characteristic.Model, d.type)
        .setCharacteristic(Characteristic.SerialNumber, d.id)

      // store some key info about this accessory in the context, so that
      // it will be persisted between restarts
      pa.context = {
        type: d.type,
        id: d.id,
        host: d.host,
        accessoryType: this.accessoryType,
        index: this.index,
      }

      return pa
    }

    _setupEventHandlers() {
      this.platformAccessory.on('identify', this.identify.bind(this))
      this.device.on('change:settings', this.updateAccessoryInformation, this)
    }

    /**
     * Updates the accessory information based on the device settings.
     */
    updateAccessoryInformation() {
      const d = this.device
      const infoService = this.platformAccessory
        .getService(Service.AccessoryInformation)

      if (d.settings && d.settings.fw) {
        const fw = d.settings.fw
        // find the version number
        const m = fw.match(/v([0-9]+(?:\.[0-9]+)*)/)
        infoService.setCharacteristic(
          Characteristic.FirmwareRevision,
          m !== null ? m[1] : fw
        )
      }

      if (d.settings && d.settings.hwinfo) {
        infoService.setCharacteristic(
          Characteristic.HardwareRevision,
          d.settings.hwinfo.hw_revision
        )
      }
    }

    /**
     * Identifies this accessory. This is usually requested by HomeKit during
     * setup.
     * @param {function} callback - Must be invoked after the accessory has been
     * identified.
     */
    identify(paired, callback) {
      this.log.info(this.name, 'at', this.device.host, 'identified')
      callback()
    }

    /**
     * Detaches this accessory and its abilities, removing all references to the
     * device that it was first associated with.
     */
    detach() {
      for (const a of this.abilities) {
        a.detach()
      }

      this.device.removeListener(
        'change:settings',
        this.updateAccessoryInformation,
        this
      )

      this.device = null
    }
  }

  /**
   * Base class for all accessories that use a Shelly device with a relay.
   */
  class ShellyRelayAccessory extends ShellyAccessory {
    /**
     * Sets the relay to the new value.
     * @returns {Promise} A Promise that resolves when the state of the relay
     * has been updated.
     */
    setRelay(newValue) {
      return this.device.setRelay(this.index, newValue)
    }

    identify(paired, callback) {
      super.identify(paired, async () => {
        const currentState = this.device['relay' + this.index]

        try {
          // invert the current state for 1 second
          await this.setRelay(!currentState)
          await new Promise(resolve => setTimeout(resolve, 1000))
          await this.setRelay(currentState)
          callback()
        } catch (e) {
          handleFailedRequest(
            this.log,
            this.device,
            e,
            'Failed to identify device'
          )
          callback(e)
        }
      })
    }
  }

  return {
    ShellyAccessory,
    ShellyRelayAccessory,
  }
}
