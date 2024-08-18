const fs            = require('fs');
const types         = require("@babel/types");
const parser        = require("@babel/parser");
const traverse      = require("@babel/traverse").default;
const generator     = require("@babel/generator").default;
const template      = require("@babel/template").default;

//js混淆代码读取
const encodeFile = process.argv.length > 2 ? process.argv[2] : "./encode.js";  //默认的js文件
const decodeFile = process.argv.length > 3 ? process.argv[3] : encodeFile.slice(0, encodeFile.length - 3) + "_ok.js";


//将源代码解析为AST
let sourceCode = fs.readFileSync(encodeFile, { encoding: "utf-8" });

let ast = parser.parse(sourceCode);


console.time("处理完毕，耗时");


const keyToLiteral = {
	ObjectProperty:
	{
		exit({ node }) {
			const key = node.key;
			if (!node.computed && types.isIdentifier(key)) {
				node.key = types.StringLiteral(key.name);
				return;
			}
			if (node.computed && types.isStringLiteral(key)) {
				node.computed = false;
			}
		}
	},
}


const standardLoop =
{
	"ForStatement|WhileStatement|ForInStatement|ForOfStatement"({ node }) {
		if (!types.isBlockStatement(node.body)) {
			node.body = types.BlockStatement([node.body]);
		}
	},
	IfStatement(path) {
		const consequent = path.get("consequent");
		const alternate = path.get("alternate");
		if (!consequent.isBlockStatement()) {
			consequent.replaceWith(types.BlockStatement([consequent.node]));
		}
		if (alternate.node !== null && !alternate.isBlockStatement()) {
			alternate.replaceWith(types.BlockStatement([alternate.node]));
		}
	},
}


traverse(ast, standardLoop);



const DeclaratorToDeclaration = 
{
   VariableDeclaration(path)
   {
      let {parentPath,node} = path;
   	  if (parentPath.isFor())
   	  {
   	 	 return;
   	  }
      let {declarations,kind} = node;

      if (declarations.length == 1)
      {
         return;
      }

      let newNodes = [];

      for (const varNode of declarations)
      {
         let newDeclartionNode = types.VariableDeclaration(kind,[varNode]);
         newNodes.push(newDeclartionNode);
      }

      path.replaceWithMultiple(newNodes);

   },
}

traverse(ast, DeclaratorToDeclaration);


let ifNODETEP = template(`if(A){B;}else{C;}`);
const ConditionToIf = {
	ConditionalExpression: {
		exit(path){
			let {test, consequent, alternate} = path.node;
			let ifStateNode = ifNODETEP({"A":test,"B":consequent,"C":alternate});
			path.replaceWithMultiple(ifStateNode);
			path.skip();
  }
 },
}


const resolveSequence =
{
    SequenceExpression:
    {
        /**  @param  {NodePath} path */
        exit(path) {

            let statementPath = path.getStatementParent();
            if (!statementPath) return;

            let canVisitFlag = true;

            statementPath.traverse({
                "LogicalExpression|ConditionalExpression"(_path) {
                    if (!_path.isAncestor(path)) {

                        return;
                    }

                    let key = _path.isLogicalExpression() ? "left" : "test";

                    let execPath = _path.get(key);

                    if (execPath != path && !execPath.isAncestor(path)) {
                        canVisitFlag = false;
                        _path.stop();
                    }
                },
            })

            if (!canVisitFlag) return;

            if (statementPath.isLoop()) {//循环表达式内的test节点，不能随意插在该表达式前面

                let initPath = statementPath.get('init');

                if (initPath.node == undefined || (initPath != path && !initPath.isAncestor(path))) {
                    return
                }
            }

            let expressions = path.node.expressions;
            let lastNode = expressions.pop();

            for (let expression of expressions) {
                statementPath.insertBefore(types.ExpressionStatement(expression = expression));
            }

            path.replaceWith(lastNode);

        }
    }
}

traverse(ast, resolveSequence);


ast = parser.parse(generator(ast).code);//重新解析一下


function containsSequenceExpression(path) {
    let containsSequence = false;
    // 深度优先遍历当前路径及其所有子路径
    path.traverse({
        SequenceExpression(_path) {
            containsSequence = true;
            _path.stop(); // 找到逗号表达式后立即停止遍历
        }
    });
    return containsSequence;
}

//请使用学员专版babel库
const constantFold = {
    "BinaryExpression|UnaryExpression"(path) {
        if (containsSequenceExpression(path)) {
            return;
        }
        if (path.isUnaryExpression({ operator: "-" }) ||
            path.isUnaryExpression({ operator: "void" })) {
            return;
        }
        const { confident, value } = path.evaluate();

        if (!confident || typeof value == "function")
            return;

        if (typeof value == 'number' && (!Number.isFinite(value))) {
            return;
        }

        console.log(path.toString(),"--->",value);

        path.replaceWith(types.valueToNode(value));
    },
}







if (1) {

	traverse(ast, keyToLiteral);

	traverse(ast, standardLoop);

	traverse(ast, DeclaratorToDeclaration);

	traverse(ast, ConditionToIf);

	traverse(ast, resolveSequence);

	ast = parser.parse(generator(ast).code);

	traverse(ast, constantFold); //需要使用专版babel库,如果不是，请将其屏蔽

}




function isReferPath(nextSibling, referencePaths) {

	let isReferPath = false;

	for (let referPath of referencePaths) {//假装判断一下，删除也行
		if (nextSibling.isAncestor(referPath)) {
			isReferPath = true;
			break;
		}
	}

	return isReferPath;
}




const callToString =
{//字符串还原
	FunctionDeclaration(path) {
		let { parentPath, node } = path;
		let { id, params, body } = node;
		let source = path.toString();
		if (!source.includes("split"))
		{
			return;
		}

		if (params.length != 1 || body.body.length != 3) {
			return;
		}

		let firstNode  = body.body[0];
		let lastNode   = body.body[2];

		if (!types.isExpressionStatement(firstNode) || !types.isReturnStatement(lastNode))
		{
			return;
		}

		let name = id.name;
		let funcName = undefined;
		let obfuscatorPaths = [path];

		let siblingPaths = parentPath.get('body'); //用来获取它的兄弟节点

		let scope = parentPath.scope;
		let binding = scope.getBinding(name);

		if (!binding) return;

		let { referencePaths } = binding;
		

		for (let siblingPath of siblingPaths) {
			if (siblingPath == path) {
				continue;
			}
			if (isReferPath(siblingPath, referencePaths)) {
				if (siblingPath.isFunctionDeclaration())
				{
					funcName = siblingPath.node.id.name;
				}
				obfuscatorPaths.push(siblingPath);
			}
		}

		if (obfuscatorPaths.length < 2 && funcName == undefined) {
			return;
		}

		let obfuscatorCode = "";
		obfuscatorPaths.forEach(eachPath => { obfuscatorCode += eachPath.toString() });

		let funcAst = parser.parse(obfuscatorCode);
		obfuscatorCode = generator(funcAst, opts = { "compact": true }).code;

		eval(obfuscatorCode);

		
		globalThis[funcName] = eval(funcName);

		scope.traverse(scope.block, {
			AssignmentExpression(_path) {
				let { scope, node } = _path;
				let { left, operator, right } = node;
				if (!types.isIdentifier(left) || operator != "=" ||
					!types.isIdentifier(right, { "name": funcName })) {
					return;
				}


				let name = left.name
				let binding = scope.getBinding(name);

				if (!binding || binding.constantViolations.length > 2) {
					return;
				}

				for (let referPath of binding.referencePaths) {
					let { parentPath, node } = referPath;
					if (!parentPath.isCallExpression({ "callee": node })) {

						referPath.replaceWith(right);

						continue;
					}

					let { callee, arguments } = parentPath.node;

					if (!types.isIdentifier(callee) || arguments.length != 1 || !types.isNumericLiteral(arguments[0])) {
						continue;
					}
					let value = globalThis[funcName](arguments[0].value);
					//console.log(parentPath.toString(), "-->", value);
					parentPath.replaceWith(types.valueToNode(value));

				}

				_path.remove();
			},
		});

		obfuscatorPaths.forEach(eachPath => { eachPath.remove(); });

	},
}

traverse(ast, callToString);






const collectKeyAndValueOfObject = {//将key和Value归并到Object内部
	AssignmentExpression({ node, parentPath }) {

		if (!parentPath.isExpressionStatement({ "expression": node })) {
			return;
		}

		let { left, operator, right } = node;
		if (!types.isIdentifier(left) || operator != "=" ||
			!types.isObjectExpression(right)) {
			return;
		}

		let name = left.name;

		let properties = right.properties;

		let allNextSiblings = parentPath.getAllNextSiblings();
		for (let nextSibling of allNextSiblings) {
			if (!nextSibling.isExpressionStatement()) break;

			let expression = nextSibling.get('expression');
			if (!expression.isAssignmentExpression({ operator: "=" })) break;

			let { left, right } = expression.node;
			if (!types.isMemberExpression(left)) break;

			let { object, property } = left;
			if (!types.isIdentifier(object, { name: name }) ||
				!types.isStringLiteral(property)) {
				break;
			}

			properties.push(types.ObjectProperty(property, right));
			nextSibling.remove();
		}

	},
}


traverse(ast, collectKeyAndValueOfObject);


const changeOfObject = {//将下一条满足条件的语句进行同样的初始化。
	AssignmentExpression(path) {

		let { parentPath, node } = path;
		if (!parentPath.isExpressionStatement({ "expression": node })) {
			return;
		}

		let { left, operator, right } = node;
		if (!types.isIdentifier(left) || operator != "=" ||
			!types.isObjectExpression(right)) {
			return;
		}

		let OldNode = right;


		let name = left.name;
		let nextSibling = parentPath.getNextSibling();
		if (nextSibling.isExpressionStatement() && nextSibling.get('expression').isAssignmentExpression()) {

			let { left, operator, right } = nextSibling.get('expression').node;

			if (types.isIdentifier(right, { "name": name })) {

				nextSibling.node.expression.right = OldNode;
			}
		}

	},
}

traverse(ast, changeOfObject);

function savePropertiesToObject(properties, newMap) { // 保存object 的 key 和 value 到 Map中
	for (const property of properties) {
		if (!property.key) {
			break;
		}
		let propKey = property.key.value;
		let propValue = property.value;
		if (!propKey || propKey.length != 5) break;//如果是ob混淆，key的长度都是5
		if (types.isStringLiteral(propValue)) {
			newMap.set(propKey, propValue);
		}
		else if (types.isFunctionExpression(propValue)) {
			let retState = propValue.body.body;
			if (retState.length == 1 && types.isReturnStatement(retState[0])) {
				let argument = retState[0].argument;
				if (types.isCallExpression(argument)) {
					newMap.set(propKey, "Call");
					continue;
				}
				if (types.isBinaryExpression(argument) ||
					types.isLogicalExpression(argument)) {
					newMap.set(propKey, argument.operator);
				}
			}
		}
		else {
			break;
		}
	}
}




const decodeObject = { //还原ob混淆的object
	AssignmentExpression(path) {

		let { node, scope } = path;
		let { left, operator, right } = node;
		if (!types.isIdentifier(left) || operator != "=" ||
			!types.isObjectExpression(right)) {
			return;
		}

		let name = left.name;
		let properties = right.properties;
		if (properties.length == 0) return;

		let binding = scope.getBinding(name);
		if (!binding || binding.constantViolations.length > 2) {
			return;
		}


		if(binding.constantViolations.length == 2)
		{
			if (binding.constantViolations[0] != path)
			{
				return;
			}
			
			if (binding.constantViolations[1].isAssignmentExpression())
			{
				let {left} = binding.constantViolations[1].node;

				if (types.isIdentifier(left,{"name":name}))
				{
					return;
				}
			}
		}

			


		if (binding.referencePaths.length == 0) {
			path.remove();
		}



		let newMap = new Map();
		savePropertiesToObject(properties, newMap);
		if (newMap.size != properties.length) return;

		for (const referPath of binding.referencePaths.reverse()) {
			let { node, parent, parentPath } = referPath;
			let ancestorPath = parentPath.parentPath;
			if (!parentPath.isMemberExpression({ object: node })) {
				continue;
			}
			let propKey = parent.property.value;
			let propValue = newMap.get(propKey);
			if (!propValue) {
				continue;
			}

			if (typeof propValue != "string") {
				parentPath.replaceWith(propValue);
				continue;
			}
			if (ancestorPath.isCallExpression({ callee: parent })) {
				let { arguments } = ancestorPath.node;
				switch (propValue) {
					case "Call":
						ancestorPath.replaceWith(types.CallExpression(arguments[0], arguments.slice(1)));
						break;
					case "||":
					case "&&":
						ancestorPath.replaceWith(types.LogicalExpression(propValue, arguments[0], arguments[1]));
						break;
					default:
						ancestorPath.replaceWith(types.BinaryExpression(propValue, arguments[0], arguments[1]));
						break;
				}
			}
		}

		newMap.clear();





	},
}


const removeDeadCode = {//删除垃圾代码
	"IfStatement|ConditionalExpression"(path) {
		let { consequent, alternate } = path.node;
		let testPath = path.get('test');
		const evaluateTest = testPath.evaluateTruthy();
		if (evaluateTest === true) {
			if (types.isBlockStatement(consequent)) {
				consequent = consequent.body;
			}
			path.replaceWithMultiple(consequent);
		}
		else if (evaluateTest === false) {
			if (alternate != null) {
				if (types.isBlockStatement(alternate)) {
					alternate = alternate.body;
				}
				path.replaceWithMultiple(alternate);
			}
			else {
				path.remove();
			}
		}
	},
	EmptyStatement(path) {
		path.remove();
	},
}


for (let i = 0; i < 2; i++) {
	traverse(ast, removeDeadCode);
	ast = parser.parse(generator(ast).code);
	traverse(ast, decodeObject);
	traverse(ast, constantFold);
}



//去控制流
const decodeControlFlow = {

	AssignmentExpression(path) {
		//将下一条满足条件的语句进行同样的初始化。
		let { node, scope, parentPath } = path;
		if (!parentPath.isExpressionStatement({ "expression": node })) {
			return;
		}
		let { left, operator, right } = node;
		if (!types.isIdentifier(left) || operator != "=" ||
			!types.isCallExpression(right)) {
			return;
		}
		let nextSibling = parentPath.getNextSibling();
		if (!nextSibling.isForStatement()) {
			return;
		}
		const { test, body } = nextSibling.node;
		if (!types.isLiteral(test, { value: true })) return;
		if (body.body.length != 2) return;
		let switchNode = body.body[0], breakNode = body.body[1];
		if (!types.isSwitchStatement(switchNode) ||
			!types.isBreakStatement(breakNode)) {
			return;
		}

		let { cases } = switchNode;
		if (!types.isStringLiteral(right.callee.object)) {
			return;
		}
		let disPatchArray = right.callee.object.value.split("|");
		let retBody = [];
		disPatchArray.forEach(index => {
			let caseBody = cases[index].consequent;
			if (types.isContinueStatement(caseBody[caseBody.length - 1])) {
				caseBody.pop();
			}
			retBody = retBody.concat(caseBody);
		})
		nextSibling.replaceWithMultiple(retBody);

		parentPath.remove();


	}
}

traverse(ast, decodeControlFlow);




console.timeEnd("处理完毕，耗时");


let { code } = generator(ast, opts = { jsescOption: { "minimal": true } });

fs.writeFile(decodeFile, code, (err) => { });