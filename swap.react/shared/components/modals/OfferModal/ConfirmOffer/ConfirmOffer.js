import React, { Component, Fragment } from 'react'

import actions from 'redux/actions'

import { links } from 'helpers'
import { Link } from 'react-router-dom'

import cssModules from 'react-css-modules'
import styles from './ConfirmOffer.scss'

import Row from 'components/Row/Row'
import Button from 'components/controls/Button/Button'
import Coins from 'components/Coins/Coins'

import Amounts from './Amounts/Amounts'
import ExchangeRate from './ExchangeRate/ExchangeRate'
import Fee from './Fee/Fee'
import { connect } from 'redaction'
import { FormattedMessage } from 'react-intl'


@connect(({ currencies: { items: currencies }, user: { ethData: { address } } }) => ({
  currencies,
  address,
}))
@cssModules(styles)
export default class ConfirmOffer extends Component {

  handleConfirm = () => {
    this.createOrder()
    actions.modals.close('OfferModal')
  }

  getUniqId = () => {
    const { address } = this.props
    let id = Date.now()

    return `${address}-${++id}`
  }

  createOrder = () => {
    const { offer: { buyAmount, sellAmount, buyCurrency, sellCurrency, exchangeRate, isPartialClosure } } = this.props

    const data = {
      buyCurrency: `${buyCurrency}`,
      sellCurrency: `${sellCurrency}`,
      buyAmount: Number(buyAmount),
      sellAmount: Number(sellAmount),
      exchangeRate: Number(exchangeRate),
      isPartialClosure,
    }

    actions.analytics.dataEvent('orderbook-addoffer-click-confirm-button')
    actions.core.createOrder(data)
    actions.core.updateCore()
  }

  render() {
    const { offer: { buyAmount, sellAmount, buyCurrency, sellCurrency, exchangeRate }, onBack, currencies } = this.props

    return (
      <Fragment>
        <Coins styleName="coins" names={[ buyCurrency, sellCurrency ]} size={100} />
        <Amounts {...{ buyAmount, sellAmount, buyCurrency, sellCurrency }} />
        <ExchangeRate {...{ value: exchangeRate, buyCurrency, sellCurrency }} />
        <Fee amount={0.0001} currency={sellCurrency} />
        <Row styleName="buttonsInRow">
          <Button styleName="button" gray onClick={onBack}>
            <FormattedMessage id="ConfirmOffer69" defaultMessage="Back" />
          </Button>
          <Link styleName="link" to={`${links.home}${buyCurrency}-${sellCurrency}`}>
            <Button styleName="button" id="confirm" brand onClick={this.handleConfirm}>
              <FormattedMessage id="ConfirmOffer73" defaultMessage="Add" />
            </Button>
          </Link>
        </Row>
      </Fragment>
    )
  }
}
