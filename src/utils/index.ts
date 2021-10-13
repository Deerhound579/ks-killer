/*
 * @copyright Microsoft Corporation. All rights reserved.
 */

import { Block, Node, Statement, ts } from 'ts-morph';

/**
 * Determine if nodeA is an ancestor of nodeB
 */
export function isAncestorOf(nodeA: Node<ts.Node>, nodeB: Node<ts.Node>): boolean {
  return nodeB.getAncestors().includes(nodeA);
}

export function unwrapBlock(target: Statement | Block): string {
  // https://github.com/dsherret/ts-morph/issues/641
  return target.getChildSyntaxListOrThrow().getText({ trimLeadingIndentation: true });
}

export * from './getInfoFromText';