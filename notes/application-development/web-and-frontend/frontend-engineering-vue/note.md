# (四)项目创建

## 1.尝试搭建blog

## (1)nodejs下载

官网下载nodejs

配置路径：node.js\   node.js\node_global

npm install hexo-cli -g # 全局安装hexo命令行工具

hexo init "你的博客目录名称" 

cd "博客目录"

npm install # 安装的依赖项在package.json文件的dependencies字段中可以看到

tree -L 1    -----不管用

## (2)git下载

官网下载git

配置路径：Git\cmd

### <u>*项目云传github的cmd指令</u>

*cd "博客目录"
*git init
***git add .**                           -------选中该目录下所有文件
*git commit -m "my blog first commit"
*git remote add origin "远端github仓库地址.git"
git branch -M main
*git push -u origin main------一直出现各种错误，百度了很久也解决不了，后面突然又行了，git config --global --unset http.proxy    git config --global --unset https.proxy

## (3)github注册及摸索

1.建库 Start a new repository

2.文件修改  进入文件，右上角笔的图像是修改，后commit changes

3.改变目录 左上角手动输入目录

4.删除文件  右上角三点，下拉delete

5.文件上传file hidden解决   如果上传的文件是 . 开头的则会出现hidden问题，最简单的是改名后上传再改回来

## (4)netlify

(弯路：这个网站的注册吐了，邮箱一注册到一半就显示什么账户可疑已被停用，换了三个邮箱全被停用，它的验证是什么驾驶证，护照，身份证，但我都还没注册完就被封了，它和什么验证？况且它是美国网站，我想应该这些证件中国的不行，煎熬了好几个小时，一直邮箱验证，最后斗胆尝试把大陆身份证上传，啊，直接行了)

删除site：site configuration->general->danger zone

## 2.项目初探索

最后发现hexo好像不符合要求，里面的样式是拿.md写的，也看不懂，便尝试换路了

开始尝试直接把我写的.html直接搞到netlify里部署，发现网页直接404

然后百度到web三大主流框架vue,angular,bootstrap并选择了学习vue,在菜鸟教程找到了vue3教程开始学习

### <u>*netlify部署github项目必要条件：</u>

三个必要文件（必须放置在最外层）

index.html
package.json       ----------------注意json中修改"name"为github库名，"dependencies", "devDependencies"的版本也要注意
vite.config.js

(这是我一个个删文件、试错得到的，终于也是解决了老是有时候vue生成的项目有的可以在netlify部署，有的一直报错)

# （六）VUE

## 1.安装vue的npm方法

### 1.

升级 npm
cnpm install npm -g

升级或安装 cnpm-------------------------------------cnpm下载更快
npm install cnpm -g

### 2.安装vue

(**弯路**:开始尝试用  npm init vue@latest ，按教程勾选一堆选项后但是一直报错，创建不了新项目，cmd中用vue指令也全部报错，经过搜索，查找node.js 的安装目录，查看一级目录下没有存在 vue.cmd 指令，确信完全没安装上vue，后最终找到另外的npm安装指令)

**npm install -g vue**

会安装并执行 create-vue

**npm install -g @vue/cli**   -------------安装脚手架vue -cli

查看是否成功

npm list vue -g   -----------查看vue版本

vue –V   ----------------查看脚手架版本

## 2.创建项目

### 1.npm init vue@latest

### 2.vue ui  图形化界面

vue ui 进入后创建项目即可

(弯路：第一次我创建时也是直接报错一页的WARN，我突然想起前面安装脚手架vue -cli的时候也是有几个WARN,于是我立马觉得是脚手架没安装上，查了资料说是npm版本过低，我就npm i -g npm(更新npm)，npm cache clean --force(清除缓存)，npm install -g @vue/cli，结果并不管用，然后又有的说是没有配置路径，我又AppData\Roaming\npm配置了个路径，但没用，然后又有的说是用npm网速不足导致的，换成cnpm下载，果然vue -cli没报WARN了，当我回到vue ui时发现还是WARN,并没解决，后把报错逐句搜索，终于是发现有人说是cmd没以**管理员身份**打开导致的，然后才发现的确如此）

### 3.vite

实现闪电般的冷服务器启动,可以使用 Vite 快速构建 Vue 项目

npm init vite-app    project-name

cd  project-name

cnpm install

cnpm run dev

打开 http://localhost:3000/

### 4.vue create 命令

vue create (options)    app-name

npm run serve  -----启动应用

打开 http://localhost:8080/

## 3.打包

cnpm run build

执行完成后，会在 Vue 项目下会生成一个 dist 目录，该目录一般包含 index.html 文件及 \_assets 目录，_assets 目录包含了静态文件 js、css 以及图片目录 images（如果有图片的话）

修改dist下html中的绝对路径为相对路径

src="/\_assets/index.47c36baf.js"   ->    src="_assets/index.47c36baf.js"

href="/\_assets/style.0637ccc5.css"  ->   href="_assets/style.0637ccc5.css"

## 4.目录结构

build 	项目构建(webpack)相关代码
config 	配置目录，包括端口号等。初学可以使用默认的。
node_modules 	npm 加载的项目依赖模块
src 	这里是我们要开发的目录，基本上要做的事情都在这个目录里。里面包含了几个目录及文件：
    assets: 放置一些图片，如logo等。
    components: 目录里面放了一个组件文件，可以不用。
    App.vue: 项目入口文件，我们也可以直接将组件写这里，而不使用 components 目录。
    main.js: 项目的核心文件。
    index.css: 样式文件。
static 	静态资源目录，如图片、字体等。
public 	公共资源目录。
test 	初始测试目录，可删除
.xxxx文件 	这些是一些配置文件，包括语法配置，git配置等。
index.html 	首页入口文件，你可以添加一些 meta 信息或统计代码啥的。
package.json 	项目配置文件。
README.md 	项目的说明文档，markdown 格式
dist 	使用 npm run build 命令打包后会生成该目录。

 **修改src/APP.vue 文件**

\<HelloWorld msg="随意内容" />

## 5.起步

先在 HTML 页面中引入 Vue 的 JS 文件：

\<script src="https://unpkg.com/vue@next">\</script>

\<div id="name2" class="demo">
  {{ name3 }}                                 -----------------------{{    }}:用于输出对象属性和函数返回值
\</div>

\<script>
const name1 = {                               -------------------------<u>vueapp</u>(name1)的设置
  data() {
    return {
      name3: '输出内容'
    }
  }
}

Vue.createApp(name1).mount('#name2')---------------------**Vue.creatApp()**:    创建<u>vueapp</u>(name1)
\</script>                                                                             <u>vueapp</u>**.mount('#id')**:    将<u>vueapp</u>挂载到id的html元素中

注：可合并两步(创建并附初始属性)

const name1 = Vue.createApp({

data(){return {------------------------data选项
value1:XX
}}

methods:{-----------------------------方法
f1(){}
}

})

const vm = app.mount('#name2')

### 函数表示法：

法1.methods:{
	f1(){},
	f2(){}
}
法2.methods:{
	f1:function (){},
	f2:function (){}
}

## 6.vue指令

v-bind 	用于将 Vue 实例的数据绑定到 HTML 元素的属性上。
v-if 	用于根据表达式的值来条件性地渲染元素或组件。
v-show 	v-show 是 Vue.js 提供的一种指令，用于根据表达式的值来条件性地显示或隐藏元素。
v-for 	用于根据数组或对象的属性值来循环渲染元素或组件。
v-on 	用于在 HTML 元素上绑定事件监听器，使其能够触发 Vue 实例中的方法或函数。
v-model 用于在表单控件和 Vue 实例的数据之间创建双向数据绑定。

### 1.v-model

v-model 用于在**表单控件**和 **Vue 实例的数据**之间创建**双向数据绑定**。

***\<input*** type="text" ***v-model="message">***\</input>

\<p>{{ message }}\</p>

将input中的输入与message双向绑定，输入的值实时改变massage值

### 2.v-bind(:)

v-bind 	用于将 Vue 实例的数据绑定到 HTML 元素的属性上。（单向输出）

1.\<img :src="imageSrc">-------------单向输出
data() {return {imageSrc: 'XX.png'}}
将data中的imageSrc的值取出到v-bind后的imageSrc中

2.(1)\<div :class="{ 'classname1':dataname1, 'classname2':dataname2 }">\</div>----**多项选择**，依据dataname1,2对应布尔的值

(2).\<div :class="classObject">\</div>----**多项选择**（*通过对象的方法*）
data() {return { classObject: { 'dataname1': false, 'dataname2': true }}

(3).\<div class="class1" :class="[dataname1, dataname2]">\</div>-----**多项并选**（*通过数组的方法*）
等同于\<div class="class1 datavalue1 datavalue2">\</div>

(4).\<div class="class1" :class="[dataname0 ? dataname1 : ' ', dataname2]">\</div>--4变体，判断后选择是否选入

3.(1)\<div :style="{ color: dataname1, fontSize: dataname2 + 'px' }">\</div>-----**内联样式设置style**----dataname1可换为[dataname1,dataname2]

(2)\<div :style="styleObject">\</div>------(*通过对象的方法*)-----styleObject可换为[styleObject1, styleObject2]
data() { return {styleObject: {color: "red",fontSize: "30px"}}}



### 3.v-on(@)

v-on 	用于在 HTML 元素上绑定事件监听器，使其能够触发 Vue 实例中的方法或函数。--可缩写：v-on:click->@click

@click和onclick区别：@click可用于修改app中data的值，触发app中 的方法

### 4.v-show

v-show 	v-show 是 Vue.js 提供的一种指令，用于根据表达式的值来条件性地显示或隐藏元素。

***\<button v-on:click="***showMessage = !showMessage***">***显示/隐藏\</button>-------每次点击将showMessage值致反
***\<p v-show="showMessage">***Hello Vue!\</p>------------------------***v-show值为ture时显示元素，否则不显示***
data() {return {showMessage: true}}

### 5.v-if v-else v-else-if

v-if 	用于根据表达式的值来条件性地渲染元素或组件。

***\<p v-if="showMessage">***Hello Vue!\</p>----------------***v-if值为true则插入元素，否则不插入***
***\<p v-else>***Goodbye Vue!\</p>

data() {return {showMessage: true}}

注意：v-if和v-show效果看似类似，实际上v-if决定是否插入，v-show决定是否显示

### 6.v-for

v-for 	用于根据数组或对象的属性值来循环渲染元素或组件。

#### (1).迭代对象

```vue
<li v-for="(item,index) in name1" >---------------------------------------name1为对象数组，index可选
      {{ item.text }}
</li>
data() {return {
      name1: [
        { text: 'Item 1' },
        { text: 'Item 2' },
        { text: 'Item 3' }
      ]
}}
```



#### (2).迭代对象属性

\<li v-for="***(value, key, index) in name1***">{{ index }}. {{ key }} : {{ value }}\</li>-----------name1为***一个对象***，key和index可选
data() {return {
      name1: {
        name: '    ',
        url: '     ',
        slogan: '      '
      }}}

#### (3).迭代整数

\<li v-for="***name1 in 10***">{{name1}}\</li>--------------------------------------------------name1***未定义***，会***从1递加迭代***10次

#### (4).可对数组元素进行处理

```vue
<li v-for="name1 in f1">{{ name1 }}</li>------------------------------------------------name1未定义，只会迭代显示f1返回值
data() {
        return { numbers: [  ,  ,  ,  ] }
    },
 computed: {
        f1() {return this.numbers.filter(number => number % 2 === 0)}-----该函数返回用filter()选择的numbers中为偶数的数
    }
```



## 7.模板语法

### 1.输出数据：{{ }}

***{{...}}*** 标签的内容将会被替代为对应组件实例中message属性的值，如果message属性的值发生了改变，{{...}} 标签内容也会更新。(可以通过使用 **v-once** 指令执行一次性地插值\<span v-once>这个将不会改变: {{ message }}\</span>)

### 2.输出html代码：v-html

***\<span v-html="rawHtml">***我会被覆盖\</span>--------------v-html**会覆盖原来的html元素**
data() {return {***rawHtml: '\<span style="color: red">这里会显示红色！\</span>'***}}

### 3.输出html元素的属性值：v-bind

一般：
\<div v-bind:id="dynamicId">\</div>

进阶：根据use的值选择是否输出元素属性值
\<style>
.class1{  }
\</style>
\<div v-bind:class="{'class1': use}">\</div>
data() {return {use: false}}

### 4.表达式支持

注意：vue语句只支持js表达式(运算式、"."访问js对象属性和方法)，不支持语句、控制流（var x=1/if(){}）

{{5+5}}    {{ ok ? 'YES' : 'NO' }}    {{ message.split('').reverse().join('') }}

### 5.指令、属性、修饰符

\<form v-on:submit.prevent="onSubmit">\</form>
          指令:属性.修饰符

## 8.组件  component      

组件：\<name1>\</name1>    最终会被替换成template定义的html语句（\<name1>将不存在）

### 1.局部组件

var My-Component-Name = {<u>***template***</u>: '\<h1>自定义组件!\</h1>'}-------------------template：模版 
const app1 = Vue.**createApp**({<u>***components***</u>: {'my-component-name': My-Component-Name}})
app1.mount('#id1')
id1下使用\<my-component-name>\</my-component-name>

### 2.全局组件

const app1 = Vue.**createApp**({ data(){} f(){} })
app1.<u>***component***</u>(  'my-component-name'   ,   {***<u>template</u>***: '\<h1>自定义组件!\</h1>' }  )
app1.mount('#id1')
id1下使用\<my-component-name>\</my-component-name>

### 3.prop选项

props: ['数据变量名']

是子组件用来**接受父组件**传递过来的**数据**的一个自定义属性。

和template放的位置相同，用上面的全局组件举例就是将my-component-name的数据传给\<h1>，即传给template定义的html元素

流程：

const app = Vue.**createApp**( {data() {return {sites: [{ id: 1, t: 'Google' },{ id: 2, t: 'Runoob' }]}}})
app.**component**('site-info', { <u>props</u>: ['id','t'],   <u>template</u>: \<h4>{{ id }} - {{ t }}\</h4>})
app.**mount**('#app')
\<site-info v-for="site in sites" :id="site.id" :t="site.t">\</site-info>

### 4.prop验证

可以为 props 中的值提供一个带有验证需求的对象，替代原来的字符串数组，验证失败时控制台警告

prop:{数据名：检查方法，数据名：检查方法，}

检查方法：

1.基础的类型检查 (`null` 和 `undefined` 会通过任何类型验证)

Number

2.多个可能的类型

[String, Number]

3.必填的字符串

{type: String,required: true}

4.带有默认值的数字

{type: Number,default: 100}

5.带有默认值的对象

{type: Object,default: function () {return { message: 'hello' }}}-----------------对象或数组默认值必须从一个工厂函数获取

6.自定义验证函数

{validator: function (value) {.....;return true/false;}}}}--------------要验证的数通过value传入函数进行验证

### 5.组件使用class属性

1.template中仅一对html元素

const app = Vue.createApp({})
app.component('name1', {template: '\<**h1 class="classA classB**">\</h1>'})
app.mount('#app')
\<**name1 class="classC classD"**>\</name1>

最终name1被替换后classABCD都保留（仅限template中只有一对html元素）

2.template中有多对html元素，需要定义哪些html对接收(使用**:class="$attrs.class**)

const app = Vue.createApp({})
app.component('name1', {template: \`\<p **:class="$attrs.class**">\</p>\<span>\</span> \`})-----注意是**反引号`**
app.mount('#app')
\<name1 class="classA">\</name1>

## 9.计算属性    computed

```js
const app = {
  data() {return {message:...}},
  computed: { 
    reversedMessage: function () {----------------- 函数作为计算属性的 getter
      return this.message.split('').reverse().join('')---this 指向 vm 实例
    }
  }
}
Vue.createApp(app).mount('#app')
{{ reversedMessage }}
```

注：message值改变时reversedMessage值也会改变

与method区别：**效果上两个都是一样**的，但是 computed 是基于它的依赖缓存，只有相关依赖发生改变时才会重新取值。而使用 methods ，在重新渲染的时候，函数总会重新调用执行。

```js
{{ message0 }}
{{ message1() }}
computed: {
    message0: 
	function () {
     	 return this.message.split('').reverse().join('')
    }
  },
methods: {
    message1: 
	function () {
     	 return this.message.split('').reverse().join('')
    }
  }
```



### 可选setter

```js
computed: {
    message0: {-------多个{
      get: function () {-----------------------getter(将app中data的值输出到{{message0}},相当于间接输出,直接输出为:{{name}})
        return this.name + ' ' + this.url
      },
      set: function (newValue) {---------------setter（修改app中data的值）
        var names = newValue.split(' ')
        this.name = names[0]
        this.url = names[names.length - 1]
      }
    }
  }

vm.message0 = '·········';------------------------调用setter的方法

```



## 10.监听属性  watched

用于监听app内data的变化并做出响应

法1：**watch :** {-----------------监听data中的数据变化，数据变化自动调用相应函数
    dataname1 (newValue, oldValue) { },-----------函数名必须与data中的数据名相同
    dataname2 (){}                                              (newXX,oldXX可直接获取变化前后的值)
}

法2：vm = Vue.createApp(app).mount('#app')
vm.**$watch**('dataname1', function (newValue, oldValue) { })

## 11.事件处理