import React, { Component } from 'react'
import PropTypes from 'prop-types'

import { connect } from 'redaction'
import actions from 'redux/actions'

import { links } from 'helpers'
import { Link } from 'react-router-dom'
import { withRouter } from 'react-router'

import styles from './UserTooltip.scss'
import CSSModules from 'react-css-modules'
import ArrowRightSvg from './images/arrow-right.svg'

import { TimerButton } from 'components/controls'
import { FormattedMessage } from 'react-intl'


@withRouter
@connect({
  feeds: 'feeds.items',
  peer: 'ipfs.peer',
})
@CSSModules(styles)
export default class UserTooltip extends Component {

  static propTypes = {
    toggle: PropTypes.func.isRequired,
    feeds: PropTypes.array.isRequired,
    peer: PropTypes.string.isRequired,
  }

  declineRequest = (orderId, participantPeer) => {
    actions.core.declineRequest(orderId, participantPeer)
    actions.core.updateCore()
  }

  acceptRequest = (orderId, participantPeer) => {
    const { toggle } = this.props

    actions.core.acceptRequest(orderId, participantPeer)
    actions.core.updateCore()

    if (typeof toggle === 'function') {
      toggle()
    }

  }

  autoAcceptRequest = (orderId, participantPeer, link) => {
    this.acceptRequest(orderId, participantPeer)
    this.props.history.push(link)
  }

  render() {
    const { feeds, peer: mePeer } = this.props

    return !!feeds.length && (
      <div styleName="column" >
        { feeds.length < 3  ? (
          feeds.map(row => {
            const { request, content: { buyAmount, buyCurrency, sellAmount, sellCurrency }, id, peer: ownerPeer } = row

            return (
              mePeer === ownerPeer &&
              request.map(({ peer, reputation }) => (
                <div styleName="userTooltip" >
                  <div key={peer}>
                    <div styleName="title">
                      <FormattedMessage id="userTooltip68" defaultMessage="User with" />
                      <b>{reputation}</b>
                      <FormattedMessage id="userTooltip72" defaultMessage="reputation wants to swap" />
                    </div>
                    <div styleName="currency">
                      <span>{buyAmount.toFixed(5)} <span styleName="coin">{buyCurrency}</span></span>
                      <span styleName="arrow"><img src={ArrowRightSvg} alt="" /></span>
                      <span>{sellAmount.toFixed(5)} <span styleName="coin">{sellCurrency}</span></span>
                    </div>
                  </div>
                  <span styleName="decline" onClick={() => this.declineRequest(id, peer)} />
                  <Link to={`${links.swap}/${sellCurrency}-${buyCurrency}/${id}`}>
                    <div styleName="checked" onClick={() => this.acceptRequest(id, peer)} />
                  </Link>
                  <TimerButton isButton={false} onClick={() => this.autoAcceptRequest(id, peer, `${links.swap}/${sellCurrency}-${buyCurrency}/${id}`)} />
                </div>
              ))
            )
          })
        ) : (
          <div styleName="feed" >
            <Link to={links.feed} >
              <FormattedMessage id="QUESTION15" defaultMessage="Go to the feed page" />
            </Link>
          </div>
        )
        }
      </div>
    )
  }
}
