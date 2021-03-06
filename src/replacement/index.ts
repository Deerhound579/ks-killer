/*
 * @copyright Microsoft Corporation. All rights reserved.
 */

import { FunctionDeclaration, Node, Project, SourceFile, SyntaxKind, ts } from 'ts-morph';
import { validate as uuidValidate } from 'uuid';
import { extractDateFromComments } from '../utils';

const KS_ACTIVATED_METHOD = `isActivated`;

export interface ICoreOptions {
  targetId?: string;
  ksFilePath?: string;
  thresholdDate?: Date;
}

interface IFindKSResult {
  ksDecls: FunctionDeclaration[];
  guids: string[];
}

// graduate ks before 180 days by default
const defaultDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 180);

/**
 * Scan the project to find KS's declaration
 * @param project Target project
 * @param targetId KS ID
 * @param ksFilePath The file containing KS declaration. This boosts performance.
 */
export function findKSDeclaration(project: Project, options: ICoreOptions): IFindKSResult {
  // May have multiple decls with the same id, so it's an array
  const result: IFindKSResult = {
    ksDecls: [],
    guids: []
  };

  const { targetId, ksFilePath, thresholdDate = defaultDate } = options;

  // find file with 'KS_ACTIVATED_METHOD'
  let ksFiles: SourceFile[] = [];
  if (ksFilePath) {
    try {
      ksFiles.push(project.getSourceFileOrThrow(ksFilePath));
    } catch (err) {
      console.error(`Invalid KS file path: ${ksFilePath}`);
    }
  } else {
    // Declarations can only appear where we have KS imports
    ksFiles = project.getSourceFiles().filter((f) => {
      const importedNames = f.getDescendantsOfKind(SyntaxKind.ImportSpecifier).map((im) => im.getName());
      const hasKsImported: boolean = importedNames.some((name) => /killswitch/i.test(name));
      return hasKsImported && f.getText().includes(`.${KS_ACTIVATED_METHOD}`);
    });
  }

  ksFiles.forEach((ksFile) => {
    const funDecls = ksFile.getChildrenOfKind(SyntaxKind.FunctionDeclaration);
    funDecls.forEach((funDecl) => {
      // restrict the structure
      // return _SPKillSwitch.isActivated(ID)
      const returnStatement = funDecl.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
      const callExp = returnStatement?.getExpressionIfKind(SyntaxKind.CallExpression);
      const accessExp = callExp?.getExpressionIfKind(SyntaxKind.PropertyAccessExpression);
      // wrong structure, skip
      if (accessExp?.getName() !== KS_ACTIVATED_METHOD) {
        return;
      }

      const firstArgument = callExp?.getArguments()[0]?.getText();
      const guid = firstArgument?.substring(1, firstArgument.length - 1);
      // TODO: should we also handle Guid.parse(ID) ?

      // if targetId is provided, it should be matched with the ks id
      if (targetId) {
        if (guid === targetId) {
          result.ksDecls.push(funDecl);
          result.guids.push(guid);
        }
      } else if (guid && uuidValidate(guid)) {
        // we want to get a valid date, either from the second argument or comments
        // if the second argument exists, it should be the date
        const secondArg = callExp?.getArguments()[1]?.getText();
        const dateString =
          secondArg && !isNaN(Date.parse(secondArg)) ? secondArg : extractDateFromComments(funDecl);

        if (dateString) {
          const parsedDate: Date = new Date(dateString);
          if (parsedDate < thresholdDate) {
            result.ksDecls.push(funDecl);
            result.guids.push(guid);
          }
        }
      }
    });
  });

  return result;
}

/**
 * Replace KS calls with 'false'
 * @param ksDecl KS Declarations. Used to find references.
 * @returns A list of nodes to be optimized.
 */
export function replaceFunCallWithFalse(ksDecl: FunctionDeclaration): {
  workList: Set<Node<ts.Node>>;
  refFiles: Array<SourceFile>;
} {
  const workList = new Set<Node<ts.Node>>();
  const refFiles = new Set<SourceFile>();
  console.log('Finding references...');
  const refSymbols = ksDecl.findReferences();
  refSymbols.forEach((refSymbol) => {
    refSymbol.getReferences().forEach((ref) => {
      const refNode = ref.getNode();
      const parent = refNode.getParent();
      // not a function call(e.g. declaration), skip
      if (!(parent?.getKind() === SyntaxKind.CallExpression)) {
        return;
      }
      const refFile = refNode.getSourceFile();
      // if it's negated, replace the whole thing with true
      const negation = parent.getParentIfKind(SyntaxKind.PrefixUnaryExpression);
      let newParent: Node<ts.Node> | undefined;
      if (negation?.getOperatorToken() === SyntaxKind.ExclamationToken) {
        newParent = negation.replaceWithText('true').getParent();
      } else {
        newParent = parent.replaceWithText('false').getParent();
      }
      if (newParent) {
        workList.add(newParent);
        refFiles.add(refFile);
      }
    });
  });
  return { workList, refFiles: [...refFiles] };
}
