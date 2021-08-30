import React, { Component } from 'react'

import { connect } from 'redaction'
import actions from 'redux/actions'
import { Link, withRouter } from 'react-router-dom'

import { links, constants } from 'helpers'

import CSSModules from 'react-css-modules'
import styles from './CurrencyWallet.scss'

import Row from 'pages/History/Row/Row'
import SwapsHistory from 'pages/History/SwapsHistory/SwapsHistory'

import Table from 'components/tables/Table/Table'
import { Button } from 'components/controls'
import PageHeadline from 'components/PageHeadline/PageHeadline'
import PageSeo from 'components/Seo/PageSeo'
import { getSeoPage } from 'helpers/seo'
import { FormattedMessage } from 'react-intl'


@connect(({ core, user,  history: { transactions, swapHistory } }) => ({
  user,
  hiddenCoinsList: core.hiddenCoinsList,
  txHistory: transactions,
  swapHistory,
}))
@withRouter
@CSSModules(styles)
export default class CurrencyWallet extends Component {

  constructor(props) {
    super(props)

    this.state = {
      name: null,
      address: null,
      balance: null,
    }
  }

  static getDerivedStateFromProps(nextProps) {
    const { user, match: { params: { fullName } } } = nextProps

    const currencyData = Object.values(user)
      .concat(Object.values(user.tokensData))
      .filter(v => v.fullName && v.fullName.toLowerCase() === fullName.toLowerCase())[0]

    const { currency, address, contractAddress, decimals, balance } = currencyData

    return {
      currency,
      address,
      contractAddress,
      decimals,
      fullName,
      balance,
    }
  }

  handleWithdraw = () => {
    const { currency, address, contractAddress, decimals, balance } = this.state

    actions.analytics.dataEvent(`balances-withdraw-${currency.toLowerCase()}`)
    actions.modals.open(constants.modals.Withdraw, {
      currency,
      address,
      contractAddress,
      decimals,
      balance,
    })
  }

  handleEosBuyAccount = async () => {
    actions.modals.open(constants.modals.EosBuyAccount)
  }

  render() {
    let { swapHistory, txHistory, location } = this.props
    const { fullName, address, balance, currency } = this.state

    txHistory = txHistory
      .filter(tx => tx.type === currency.toLowerCase())

    swapHistory = Object.keys(swapHistory)
      .map(key => swapHistory[key])
      .filter(swap => swap.sellCurrency === currency || swap.buyCurrency === currency)

    const seoPage = getSeoPage(location.pathname)

    const eosAccountActivated = localStorage.getItem(constants.localStorage.eosAccountActivated) === "true"

    return (
      <div className="root">
        <PageSeo
          location={location}
          defaultTitle={
            `Swap.Online - ${fullName} (${currency}) Web Wallet with Atomic Swap.`}
          defaultDescription={
            `Atomic Swap Wallet allows you to manage and securely exchange ${fullName} (${currency}) with 0% fees. Based on Multi-Sig and Atomic Swap technologies.`
          } />
        <PageHeadline styleName="title" subTitle={!!seoPage ? seoPage.h1 : `Your online ${fullName} (${currency}) web wallet with Atomic Swap.`} />
        <h3 styleName="subtitle">
          <FormattedMessage id="CurrencyWallet95" defaultMessage="Your address:" />
          <span>{address}</span> <br /> Your {fullName} balance: {balance}{' '}{currency.toUpperCase()}
        </h3>
        {!eosAccountActivated && (<Button onClick={this.handleEosBuyAccount} gray>
          <FormattedMessage id="CurrencyWallet105" defaultMessage="Activate account" />
        </Button>)}
        <div styleName="inRow">
          <Button brand style={{ marginRight: '15px' }} onClick={this.handleWithdraw}>
            <FormattedMessage id="CurrencyWallet100" defaultMessage="Send" />
          </Button>
          <Link to={`${links.home}${currency.toLowerCase()}`} >
            <Button gray>
              <FormattedMessage id="CurrencyWallet104" defaultMessage="Exchange" />
            </Button>
          </Link>
        </div>
        { swapHistory.length > 0 && <SwapsHistory orders={swapHistory} /> }
        <h2 style={{ marginTop: '20px' }} >
          <FormattedMessage id="CurrencyWallet110" defaultMessage="History your transactions" />
        </h2>
        {txHistory && (<Table titles={[ 'Coin', 'Status', 'Statement', 'Amount' ]} rows={txHistory}styleName="table" rowRender={(row) => (<Row key={row.hash} {...row} />)} />)}
      </div>
    )
  }
}
