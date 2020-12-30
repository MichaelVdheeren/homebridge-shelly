const { handleFailedRequest } = require('../error-handlers')

module.exports = homebridge => {
  const { Ability } = require('./base')(homebridge)
  const Characteristic = homebridge.hap.Characteristic
  const Service = homebridge.hap.Service

  class GarageDoorSwitchAbility extends Ability {
    /**
     * @param {string} switchProperty - The device property to trigger the
     * garage door to open or close.
     * @param {string} stateProperty - The device property used to indicate the
     * garage door is closed.
     * @param {string} movementTime - The time required before the door has
     * either completely closed or opened.
     * @param {string} pulseTime - The time a pulse is required to activate the
     * garage door motor
     * @param {function} setSwitch - A function that updates the device's switch
     * state. Must return a Promise.
     */
    constructor(switchProperty, stateProperty,
      movementTime, pulseTime, setSwitch) {
      const CDS = Characteristic.CurrentDoorState

      super()
      this._switchProperty = switchProperty
      this._stateProperty = stateProperty
      this._setSwitch = setSwitch
      this._movementTime = movementTime
      this._movementTimer = null
      this._pulseTime = pulseTime
      this._targetState = null
      this._preStoppedState = null
      this._currentState = this.state > 0 ? CDS.CLOSED : CDS.OPEN
    }

    get state() {
      return this.device[this._stateProperty] || 0
    }

    get isSwitchedOn() {
      return this.device[this._switchProperty] || false
    }

    get currentState() {
      return this._currentState
    }

    _setCurrentState(newState, source) {
      const CDS = Characteristic.CurrentDoorState

      if (this.currentState === CDS.STOPPED) {
        // Leaving Stopped state - reset the "obstruction detected" flag.
      }

      if (newState === CDS.STOPPED) {
      // Entering Stopped state - remember what was the previous state.
        this._preStoppedState = this.currentState
        // var obstNotify = true
      }

      this.platformAccessory
        .getService(Service.GarageDoorOpener)
        .setCharacteristic(CDS)
        .setValue(newState, null, source)
    }

    _setTargetState(newState, source) {
      const TDS = Characteristic.TargetDoorState

      this.platformAccessory
        .getService(Service.GarageDoorOpener)
        .setCharacteristic(TDS)
        .setValue(newState, null, source)
    }

    _toggleState(source) {
      const TDS = Characteristic.TargetDoorState
      const CDS = Characteristic.CurrentDoorState

      var newState = this.targetState
      var currentState = this.currentState

      switch (currentState) {
        case CDS.OPEN:
          this.setTargetState(newState, source)
          this.setCurrentState(CDS.CLOSING)
          break
        case CDS.CLOSED:
          this.setTargetState(newState, source)
          this.setCurrentState(CDS.OPENING)
          break
        case CDS.OPENING:
          this.setTargetState(newState, source)
          this.setCurrentState(CDS.STOPPED)
          break
        case CDS.CLOSING:
          this.setTargetState(newState, source)
          this.setCurrentState(CDS.OPENING)
          break
        case CDS.STOPPED:
          if (this._preStoppedState === CDS.OPENING) {
            this.setTargetState(TDS.CLOSED, 'fixup')
            this.setCurrentState(CDS.CLOSING)
          } else {
            this.setTargetState(TDS.OPEN, 'fixup')
            this.setCurrentState(CDS.OPENING)
          }
          break
      }
    }

    get targetState() {
      if (this._targetState !== null) {
        return this._targetState
      }

      const CDS = Characteristic.CurrentDoorState
      const TDS = Characteristic.TargetDoorState
      const cs = this.currentState
      return cs === CDS.OPEN || cs === CDS.OPENING ? TDS.OPEN : TDS.CLOSED
    }

    _setupPlatformAccessory() {
      const CDS = Characteristic.CurrentDoorState
      const TDS = Characteristic.TargetDoorState
      super._setupPlatformAccessory()

      // This is the initial setup of the garage door
      this.platformAccessory.addService(
        new Service.GarageDoorOpener()
          .setCharacteristic(CDS, this.currentState)
          .setCharacteristic(TDS, this.targetState)
          .setCharacteristic(Characteristic.ObstructionDetected, false)
      )
    }

    _setupEventHandlers() {
      super._setupEventHandlers()

      // This is the handler to catch HomeKit events
      this.platformAccessory
        .getService(Service.GarageDoorOpener)
        .getCharacteristic(Characteristic.TargetDoorState)
        .on('set', this._targetDoorStateSetHandler.bind(this))

      // this.platformAccessory
      //   .getService(Service.GarageDoorOpener)
      //   .getCharacteristic(Characteristic.CurrentDoorState)
      //   .on('get', this.getState.bind(this))
      //
      // this.platformAccessory
      //   .getService(Service.GarageDoorOpener)
      //   .getCharacteristic(Characteristic.TargetDoorState)
      //   .on('get', this.getState.bind(this))

      // This is the handler to catch device events
      // This one is always correct!
      this.device
        .on(
          'change:' + this._stateProperty,
          this._stateChangeHandler,
          this
        )
    }

    async _pulse() {
      // If a pulse is already ongoing, don't set another one
      if (this.isSwitchedOn) {
        return
      }

      // Give the pulse, then after pulse time set the switch back to false
      await this._setSwitch(true)
      setTimeout(async () => {
        await this._setSwitch(false)
      }, this._pulseTime)
    }

    /**
     * Handles changes from HomeKit to the TargetDoorState characteristic.
     */
    async _targetDoorStateSetHandler(newValue, callback, context) {
      const d = this.device

      // If the context is shelly then this is an internal update
      // to ensure that homekit is in sync with the current status
      // If not, we really trigger the switch
      this._targetState = newValue

      this.log.debug(
        'Target homekit state is',
        newValue
      )

      this.log.debug(
        'Setting',
        this._switchProperty,
        'of device',
        d.type,
        d.id,
        'to',
        true
      )

      if (context === 'ext') {
        callback()
        return
      }

      try {
        await this._pulse()
        callback()
        // this.updateGarageDoorState()
      } catch (e) {
        handleFailedRequest(
          this.log,
          d,
          e,
          'Failed to set ' + this._switchProperty
        )
        callback(e)
      }
    }

    /**
     * Handles changes from the device to the state property.
     * This means either the garage door just closed or it has started to open.
     */
    _stateChangeHandler(newValue) {
      this.log.debug(
        this._stateProperty,
        'of device',
        this.device.type,
        this.device.id,
        'changed to',
        newValue
      )

      this.updateGarageDoorState()
    }

    updateGarageDoorState() {
      const CDS = Characteristic.CurrentDoorState
      const TDS = Characteristic.TargetDoorState

      if (this.currentState === CDS.CLOSED) {
        this._setTargetState(TDS.CLOSED, 'ext')
        this._setCurrentState(CDS.CLOSING)

        setTimeout(() => {
          this._setCurrentState(CDS.CLOSED)
        }, 1000)
      } else {
        this._setTargetState(TDS.OPEN, 'ext')
        this._setCurrentState(CDS.OPENING)

        setTimeout(() => {
          this._setCurrentState(CDS.OPEN)
        }, 1000)
      }
    }

    getState(callback) {
      callback(null, this.currentState)
    }

    detach() {
      this.device
        .removeListener(
          'change:' + this._stateProperty,
          this._stateChangeHandler,
          this
        )

      super.detach()
    }
  }

  return GarageDoorSwitchAbility
}
